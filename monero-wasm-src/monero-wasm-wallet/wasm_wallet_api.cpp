#include <iostream>
#include <memory>
#include <algorithm>
#include <array>
#include <type_traits>
#include <utility>
#include <cmath>
#include <limits>
#include "wallet/wallet2.h"
#include "wallet/api/wallet2_api.h"
#include "version.h"
#include "mnemonics/electrum-words.h"
#include <thread>
#include <map>
#include <set>
#include "memwipe.h"

#include <emscripten.h>
#include <emscripten/bind.h>
#include "emscripten/proxying.h"

#include "http.hpp"

#include <emscripten/val.h>
#include <optional>
#include <cstdint>

#include "multisig/multisig.h"
#include "multisig/multisig_account.h"
#include "multisig/multisig_kex_msg.h"
#include "multisig/multisig_tx_builder_ringct.h"
#include "jsPromise.hpp"
#include "emval_helpers.hpp"

using WalletNetworkTypeBacking = std::underlying_type_t<cryptonote::network_type>;
using WalletPriorityBacking = std::underlying_type_t<Monero::PendingTransaction::Priority>;
using WalletTxHandle = std::uint32_t;

static_assert(std::is_same_v<WalletNetworkTypeBacking, std::uint8_t>,
              "cryptonote::network_type backing type must be uint8_t");
static_assert(std::is_same_v<WalletPriorityBacking, unsigned int>,
              "Monero::PendingTransaction::Priority backing type must be unsigned int");

class MoneroWasmWallet : public tools::i_wallet2_callback
{
public:
    // Full wallet callbacks
    void on_new_block(uint64_t height, const cryptonote::block &block) override
    {
        auto timestamp = block.timestamp;
        mainThreadQueue.proxyAsync(
            mainThread,
            [this, height, timestamp]()
            {
                if (m_on_new_block_callback.isNull() || m_on_new_block_callback.isUndefined())
                {
                    return;
                }
                m_on_new_block_callback(height, timestamp);
            });
    }
    /*
    virtual void on_reorg(uint64_t height, uint64_t blocks_detached, size_t transfers_detached) {}
    virtual void on_money_received(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& tx, uint64_t amount, uint64_t burnt, const cryptonote::subaddress_index& subaddr_index, bool is_change, uint64_t unlock_time) {}
    virtual void on_unconfirmed_money_received(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& tx, uint64_t amount, const cryptonote::subaddress_index& subaddr_index) {}
    virtual void on_money_spent(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& in_tx, uint64_t amount, const cryptonote::transaction& spend_tx, const cryptonote::subaddress_index& subaddr_index) {}
    virtual void on_skip_transaction(uint64_t height, const crypto::hash &txid, const cryptonote::transaction& tx) {}
    virtual boost::optional<epee::wipeable_string> on_get_password(const char *reason) { return boost::none; }
    // Device callbacks
    virtual void on_device_button_request(uint64_t code) {}
    virtual void on_device_button_pressed() {}
    virtual boost::optional<epee::wipeable_string> on_device_pin_request() { return boost::none; }
    virtual boost::optional<epee::wipeable_string> on_device_passphrase_request(bool & on_device) { on_device = true; return boost::none; }
    virtual void on_device_progress(const hw::device_progress& event) {};
    // Common callbacks
    virtual void on_pool_tx_removed(const crypto::hash &txid) {}
    virtual ~my_callbacks() {}
    */

    MoneroWasmWallet(WalletNetworkTypeBacking network_type_value)
        : m_wallet(
              static_cast<cryptonote::network_type>(network_type_value),      // nettype
              1,                                                              // kdf_rounds
              true,                                                           // unattended
              std::make_unique<js_client_factory>())                          // http_client_factory
    {
        // TODO: Start the worker thread

        std::cout << "Wallet created" << std::endl;
        m_wallet.callback(this);

        pthread_create(&walletThread, NULL, [](void *) -> void *
                       { emscripten_exit_with_live_runtime(); }, NULL);
    }
    ~MoneroWasmWallet()
    {
        destroy_all_tx_handles_impl();
        pthread_cancel(walletThread);
        // pthread_join(walletThread, NULL);
        m_wallet.stop();
        std::cout << "Wallet destroyed" << std::endl;
    }

    auto init()
    {
        return promise([this]()
                       { return m_wallet.init("127.1.2.3"); });
    }

    auto get_daemon_blockchain_height()
    {
        return promise([this]()
                       {
                           auto err = std::string{};
                           auto blockchain_height = m_wallet.get_daemon_blockchain_height(err);
                           if (!err.empty())
                           {
                               throw std::runtime_error(err);
                           }
                           return blockchain_height; });
    }

    auto generate(
        std::string fileName,
        std::string password,
        emscripten::val secretArrayBuf,
        bool recover,
        bool two_random)
    {
        validate_js_uint8_array_len(secretArrayBuf, 32, "secret32");
        auto secretKey = std::make_shared<crypto::secret_key>();
        copy_js_uint8_array_to(secretArrayBuf, reinterpret_cast<std::uint8_t *>(secretKey->data), 32);

        return promise(
            [this,
             fileName = std::move(fileName),
             password = std::move(password),
             secretKey,
             recover,
             two_random]()
            {
                return m_wallet.generate(
                    fileName,
                    epee::wipeable_string(password),
                    *secretKey,
                    recover,
                    two_random);
            },
            [](const auto &r) -> emscripten::val
            {
                auto v = emscripten::val::global("Uint8Array").new_(32);
                for (size_t i = 0; i < 32; ++i)
                {
                    v.set(i, r.data[i]);
                }
                return v;
            });
    }

    auto generate_multisig_restore(
        std::string fileName,
        std::string password,
        std::string multisig_data_hex,
        bool create_address_file)
    {
        epee::wipeable_string password_w{password};
        epee::wipeable_string multisig_seed_hex{multisig_data_hex};
        auto multisig_seed_hex_ptr = std::make_shared<epee::wipeable_string>(std::move(multisig_seed_hex));
        auto password_ptr = std::make_shared<epee::wipeable_string>(std::move(password_w));

        return promise([this,
                        fileName = std::move(fileName),
                        password_ptr,
                        multisig_seed_hex_ptr,
                        create_address_file]()
                       {
                           const boost::optional<epee::wipeable_string> parsed = multisig_seed_hex_ptr->parse_hexstr();
                           if (!parsed)
                           {
                               throw std::runtime_error("Multisig seed failed verification");
                           }
                           m_wallet.generate(
                               fileName,
                               *password_ptr,
                               *parsed,
                               create_address_file);
                           return true;
                       });
    }

    auto generate_from_keys(
        std::string fileName,
        std::string password,
        std::string address,
        emscripten::val secret_view_key_buf,
        emscripten::val secret_spend_key_buf,
        bool create_address_file)
    {
        validate_js_uint8_array_len(secret_view_key_buf, 32, "secretViewKey");
        validate_js_uint8_array_len(secret_spend_key_buf, 32, "secretSpendKey");
        auto viewkey = std::make_shared<crypto::secret_key>();
        auto spendkey = std::make_shared<crypto::secret_key>();
        copy_js_uint8_array_to(secret_view_key_buf, reinterpret_cast<std::uint8_t *>(viewkey->data), 32);
        copy_js_uint8_array_to(secret_spend_key_buf, reinterpret_cast<std::uint8_t *>(spendkey->data), 32);

        return promise([this,
                        fileName = std::move(fileName),
                        password = std::move(password),
                        address = std::move(address),
                        viewkey,
                        spendkey,
                        create_address_file]()
                       {
                           cryptonote::address_parse_info info;
                           if (!cryptonote::get_account_address_from_str(info, m_wallet.nettype(), address))
                           {
                               throw std::runtime_error("Invalid wallet address");
                           }
                           if (info.is_subaddress)
                           {
                               throw std::runtime_error("Subaddress cannot be used for restore from keys");
                           }

                           m_wallet.generate(
                               fileName,
                               epee::wipeable_string(password),
                               info.address,
                               *spendkey,
                               *viewkey,
                               create_address_file);
                           return true;
                       });
    }

    auto generate_view_only_from_keys(
        std::string fileName,
        std::string password,
        std::string address,
        emscripten::val secret_view_key_buf,
        bool create_address_file)
    {
        validate_js_uint8_array_len(secret_view_key_buf, 32, "secretViewKey");
        auto viewkey = std::make_shared<crypto::secret_key>();
        copy_js_uint8_array_to(secret_view_key_buf, reinterpret_cast<std::uint8_t *>(viewkey->data), 32);

        return promise([this,
                        fileName = std::move(fileName),
                        password = std::move(password),
                        address = std::move(address),
                        viewkey,
                        create_address_file]()
                       {
                           cryptonote::address_parse_info info;
                           if (!cryptonote::get_account_address_from_str(info, m_wallet.nettype(), address))
                           {
                               throw std::runtime_error("Invalid wallet address");
                           }
                           if (info.is_subaddress)
                           {
                               throw std::runtime_error("Subaddress cannot be used for restore from keys");
                           }

                           m_wallet.generate(
                               fileName,
                               epee::wipeable_string(password),
                               info.address,
                               *viewkey,
                               create_address_file);
                           return true;
                       });
    }

    auto store()
    {
        return promise([this]()
                       {
                           m_wallet.store();
                           return true; });
    }

    auto set_attribute(std::string key, std::string value)
    {
        return promise([this, key = std::move(key), value = std::move(value)]()
                       {
                           m_wallet.set_attribute(key, value);
                           return true; });
    }

    auto get_attribute(std::string key)
    {
        return promise([this, key = std::move(key)]()
                       {
                           auto r = std::string{};
                           m_wallet.get_attribute(key, r);
                           return r; });
    }

    auto load(
        std::string fileName,
        std::string password)
    {
        // This method do not call http but it might take some time, so we run it in the worker thread
        return promise([this, fileName = std::move(fileName), password = std::move(password)]()
                       {
                           m_wallet.load(fileName, epee::wipeable_string(password));
                           return true; });
    }

    // TODO: This actually not needed because it will close in destructor
    auto close_wallet()
    {
        return promise([this]()
                       {
                           m_wallet.stop();
                           m_wallet.deinit();
                           return true; });
    }

    auto words_to_bytes(std::string words,
                        std::string language_name)
    {
        return promise(
            [words = std::move(words), language_name = std::move(language_name)]() mutable -> std::optional<std::array<std::uint8_t, 32>>
            {
                crypto::secret_key dst{};
                auto words_param = epee::wipeable_string(words);
                const bool r = crypto::ElectrumWords::words_to_bytes(words_param, dst, language_name);
                if (!r)
                {
                    return std::nullopt;
                }
                std::array<std::uint8_t, 32> bytes{};
                std::copy_n(
                    reinterpret_cast<const std::uint8_t *>(dst.data),
                    bytes.size(),
                    bytes.begin());
                return bytes;
            },
            [](const std::optional<std::array<std::uint8_t, 32>> &seed_bytes) -> emscripten::val
            {
                if (!seed_bytes.has_value())
                {
                    return emscripten::val::null();
                }
                return MoneroWasmWallet::copy_bytes_to_uint8_array(
                    seed_bytes->data(),
                    seed_bytes->size());
            });
    }

    auto get_address()
    {
        return promise([this]()
                       { return m_wallet.get_address_as_str(); });
    }

    auto get_network_type()
    {
        return promise([this]()
                       { return static_cast<WalletNetworkTypeBacking>(m_wallet.nettype()); });
    }

    auto allow_mismatched_daemon_version(bool allow_mismatch)
    {
        return promise_void([this, allow_mismatch]()
                            { m_wallet.allow_mismatched_daemon_version(allow_mismatch); });
    }

    auto watch_only()
    {
        return promise([this]()
                       { return m_wallet.watch_only(); });
    }

    auto is_deterministic()
    {
        return promise([this]()
                       { return m_wallet.is_deterministic(); });
    }

    auto get_keys(uint32_t account_idx)
    {
        using KeysPayload = std::tuple<std::string, crypto::secret_key, crypto::public_key, bool, crypto::secret_key, crypto::public_key>;
        return promise(
            [this, account_idx]() -> KeysPayload
            {
                if (account_idx >= m_wallet.get_num_subaddress_accounts())
                {
                    throw std::runtime_error("Account index out of range");
                }

                const auto &keys = m_wallet.get_account().get_keys();
                const bool has_spend_private = !m_wallet.watch_only() && keys.m_spend_secret_key != crypto::null_skey;
                return KeysPayload{
                    m_wallet.get_subaddress_as_str({account_idx, 0}),
                    keys.m_view_secret_key,
                    keys.m_account_address.m_view_public_key,
                    has_spend_private,
                    keys.m_spend_secret_key,
                    keys.m_account_address.m_spend_public_key};
            },
            [](const KeysPayload &payload) -> emscripten::val
            {
                auto result = emscripten::val::object();
                result.set("address", std::get<0>(payload));

                auto view_key = emscripten::val::object();
                auto *view_private_bytes = reinterpret_cast<const std::uint8_t *>(std::get<1>(payload).data);
                auto *view_public_bytes = reinterpret_cast<const std::uint8_t *>(std::get<2>(payload).data);
                view_key.set("private", MoneroWasmWallet::copy_bytes_to_uint8_array(view_private_bytes, 32));
                view_key.set("public", MoneroWasmWallet::copy_bytes_to_uint8_array(view_public_bytes, 32));
                result.set("viewKey", view_key);

                auto spend_key = emscripten::val::object();
                if (std::get<3>(payload))
                {
                    auto *spend_private_bytes = reinterpret_cast<const std::uint8_t *>(std::get<4>(payload).data);
                    spend_key.set("private", MoneroWasmWallet::copy_bytes_to_uint8_array(spend_private_bytes, 32));
                }
                else
                {
                    spend_key.set("private", emscripten::val::null());
                }
                auto *spend_public_bytes = reinterpret_cast<const std::uint8_t *>(std::get<5>(payload).data);
                spend_key.set("public", MoneroWasmWallet::copy_bytes_to_uint8_array(spend_public_bytes, 32));
                result.set("spendKey", spend_key);

                return result;
            });
    }

    auto get_num_subaddresses(uint32_t index_major)
    {
        return promise([this, index_major]()
                       { return m_wallet.get_num_subaddresses(index_major); });
    }
    auto get_subaddress_as_str(uint32_t m_current_subaddress_account, uint32_t index)
    {
        return promise([this, m_current_subaddress_account, index]()
                       {
                           auto subaddr_index = cryptonote::subaddress_index{m_current_subaddress_account, index};
                           return m_wallet.get_subaddress_as_str(subaddr_index); });
    }
    auto get_subaddress_label(uint32_t m_current_subaddress_account, uint32_t index)
    {
        return promise([this, m_current_subaddress_account, index]()
                       { return m_wallet.get_subaddress_label({m_current_subaddress_account, index}); });
    }

    struct WalletAddress
    {
        std::string address;
        std::string label;
        uint32_t indexMinor;
    };

    auto get_wallet_addresses(uint32_t accountId)
    {
        return promise(
            [this, accountId]()
            {
                auto result = std::vector<WalletAddress>{};
                auto count = m_wallet.get_num_subaddresses(accountId);
                result.reserve(count);
                for (uint32_t indexMinor = 0; indexMinor < count; ++indexMinor)
                {
                    auto subaddr_index = cryptonote::subaddress_index{accountId, indexMinor};
                    result.push_back(WalletAddress{
                        m_wallet.get_subaddress_as_str(subaddr_index),
                        m_wallet.get_subaddress_label(subaddr_index),
                        indexMinor,
                    });
                }
                std::sort(result.begin(), result.end(), [](const WalletAddress &a, const WalletAddress &b)
                          { return a.indexMinor < b.indexMinor; });
                return result;
            },
            [](const std::vector<WalletAddress> &addrs) -> emscripten::val
            {
                return vector_to_js_array(addrs, [](const WalletAddress &wa)
                                          { return wallet_address_to_val(wa); });
            });
    }
    auto add_subaddress(uint32_t index_major, const std::string &label)
    {
        return promise([this, index_major, label]()
                       {
                           m_wallet.add_subaddress(index_major, label);
                           return true; });
    }

    auto is_synced()
    {
        return promise([this]()
                       { return m_wallet.is_synced(); });
    }

    auto get_seed(std::string seed_language, std::string seedPassphrase)
    {
        return promise(
            [this, seed_language = std::move(seed_language), seedPassphrase = std::move(seedPassphrase)]()
            {
                m_wallet.set_seed_language(seed_language);
                auto r = epee::wipeable_string{};
                auto isOk = m_wallet.get_seed(r, seedPassphrase);
                if (!isOk)
                {
                    throw std::runtime_error("Failed to get seed");
                }
                return r;
            },
            [](const auto &r) -> emscripten::val
            {
                auto seedStr = std::string(r.data(), r.size());
                return emscripten::val(seedStr);
            });
    }

    auto get_multisig_seed(std::string seedPassphrase)
    {
        return promise(
            [this, seedPassphrase = std::move(seedPassphrase)]()
            {
                auto r = epee::wipeable_string{};
                auto isOk = m_wallet.get_multisig_seed(r, seedPassphrase);
                if (!isOk)
                {
                    throw std::runtime_error("Failed to get multisig seed");
                }
                return r;
            },
            [](const auto &r) -> emscripten::val
            {
                auto seedStr = std::string(r.data(), r.size());
                return emscripten::val(seedStr);
            });
    }

    auto rewrite(const std::string &wallet_file, const std::string &password_str)
    {
        const epee::wipeable_string password{password_str};
        return promise([this, wallet_file, password]()
                       {
                           m_wallet.rewrite(wallet_file, password);
                           return true; });
    }

    struct RefreshResult
    {
        uint64_t blocksFetched;
        bool receivedMoney;
    };

    struct MultisigStatus
    {
        bool multisig_is_active;
        bool kex_is_done;
        bool is_ready;
        uint32_t multisig_rounds_passed;
        uint32_t threshold;
        uint32_t total;
    };

    struct KeyImagesImportResult
    {
        uint64_t height;
        uint64_t spent;
        uint64_t unspent;
    };

    struct PendingTxDestinationInfo
    {
        std::string dst_address;
        uint64_t dsp_amount;
    };

    struct PendingTxInfo
    {
        uint64_t fee;
        uint64_t change_amount;
        std::vector<PendingTxDestinationInfo> destinations;
    };

    auto refresh(bool trusted_daemon, uint64_t start_height, bool check_pool = true, bool try_incremental = true, uint64_t max_blocks = std::numeric_limits<uint64_t>::max())
    {
        return promise([this, trusted_daemon, start_height, check_pool, try_incremental, max_blocks]()
                       {
                           auto r = RefreshResult{};
                           m_wallet.refresh(trusted_daemon, start_height, r.blocksFetched, r.receivedMoney, check_pool, try_incremental, max_blocks);
                           return r; });
    }

    auto set_on_new_block_callback(emscripten::val callback)
    {
        auto p = makePromise();
        m_on_new_block_callback = callback;
        p.resolve(emscripten::val::undefined());
        return p.promise;
    }

    struct PaymentDetails
    {
        struct Destination
        {
            std::string address;
            uint64_t amount;
        };

        std::string payment_id;
        std::string type;
        bool is_unlocked;
        uint64_t block_height;
        uint64_t unlock_time;
        uint64_t timestamp;
        uint64_t amount;
        std::string tx_hash;
        uint64_t fee;
        std::vector<Destination> destinations;
        uint32_t index_major;
        uint32_t index_minor;
        std::string note;
    };

    // TODO: Add support for sub-addresses filtering
    auto get_payments(uint64_t min_height, uint64_t max_height)
    {
        return promise(
            [this, min_height, max_height]()
            { return get_payments_impl(min_height, max_height); },
            [](const std::vector<PaymentDetails> &items) -> emscripten::val
            {
                return vector_to_js_array(items, [](const PaymentDetails &p)
                                          { return payment_details_to_val(p); });
            });
    }

    std::vector<PaymentDetails> get_payments_impl(uint64_t min_height, uint64_t max_height)
    {
        std::vector<PaymentDetails> result;
        { // Incoming payments
            std::list<std::pair<crypto::hash, tools::wallet2::payment_details>> payments;

            m_wallet.get_payments(payments, min_height, max_height);

            for (auto i = payments.begin(); i != payments.end(); ++i)
            {
                auto &payment_id = i->first;
                /** Payment details */
                auto &pd = i->second;
                const std::string type = pd.m_coinbase ? "block" : "in";

                const bool unlocked = m_wallet.is_transfer_unlocked(pd.m_unlock_time, pd.m_block_height);
                uint64_t fee = 0;

                std::vector<PaymentDetails::Destination> destinations{
                    PaymentDetails::Destination{
                        m_wallet.get_subaddress_as_str({pd.m_subaddr_index.major, pd.m_subaddr_index.minor}),
                        pd.m_amount}};

                std::string note = m_wallet.get_tx_note(pd.m_tx_hash);

                result.push_back({
                    .payment_id = epee::string_tools::pod_to_hex(payment_id),
                    .type = type,
                    .is_unlocked = unlocked,
                    .block_height = pd.m_block_height,
                    .unlock_time = pd.m_unlock_time,
                    .timestamp = pd.m_timestamp,
                    .amount = pd.m_amount,
                    .tx_hash = epee::string_tools::pod_to_hex(pd.m_tx_hash),
                    .fee = fee,
                    .destinations = std::move(destinations),
                    .index_major = pd.m_subaddr_index.major,
                    .index_minor = pd.m_subaddr_index.minor,
                    .note = note,
                });
            }
        }
        { // Outgoing payments
            std::list<std::pair<crypto::hash, tools::wallet2::confirmed_transfer_details>> payments;
            m_wallet.get_payments_out(payments, min_height, max_height);
            for (auto i = payments.begin(); i != payments.end(); ++i)
            {
                auto &tx_hash = i->first;
                /** Payment details */
                auto &pd = i->second;
                const std::string type = "out";

                const bool unlocked = m_wallet.is_transfer_unlocked(pd.m_unlock_time, pd.m_block_height);
                uint64_t change = pd.m_change == (uint64_t)-1 ? 0 : pd.m_change; // change may not be known
                uint64_t fee = pd.m_amount_in - pd.m_amount_out;

                std::vector<PaymentDetails::Destination> destinations;
                destinations.reserve(pd.m_dests.size());
                for (const auto &d : pd.m_dests)
                {
                    destinations.push_back(PaymentDetails::Destination{
                        d.address(m_wallet.nettype(), pd.m_payment_id),
                        d.amount});
                }

                std::string note = m_wallet.get_tx_note(i->first);

                result.push_back({.payment_id = epee::string_tools::pod_to_hex(pd.m_payment_id),
                                  .type = type,
                                  .is_unlocked = unlocked,
                                  .block_height = pd.m_block_height,
                                  .unlock_time = pd.m_unlock_time,
                                  .timestamp = pd.m_timestamp,
                                  .amount = pd.m_amount_in - change - fee,
                                  .tx_hash = epee::string_tools::pod_to_hex(tx_hash),
                                  .fee = fee,
                                  .destinations = std::move(destinations),
                                  .index_major = pd.m_subaddr_account,
                                  // TODO: For ourgoing it can be multiple sub-addresses
                                  .index_minor = 0xFFFFFFFF,
                                  .note = note});
            }
        }
        {
            // mempool is another API method
        }
        {
            std::list<std::pair<crypto::hash, tools::wallet2::unconfirmed_transfer_details>> upayments;
            m_wallet.get_unconfirmed_payments_out(upayments);
            for (auto i = upayments.begin(); i != upayments.end(); ++i)
            {

                /** Payment details */
                auto &pd = i->second;

                uint64_t amount = pd.m_amount_in;
                uint64_t fee = amount - pd.m_amount_out;

                std::vector<PaymentDetails::Destination> destinations;
                destinations.reserve(pd.m_dests.size());
                for (const auto &d : pd.m_dests)
                {
                    destinations.push_back(PaymentDetails::Destination{
                        d.address(m_wallet.nettype(), pd.m_payment_id),
                        d.amount});
                }

                std::string payment_id = epee::string_tools::pod_to_hex(i->second.m_payment_id);

                std::string note = m_wallet.get_tx_note(i->first);

                bool is_failed = pd.m_state == tools::wallet2::unconfirmed_transfer_details::failed;

                std::string type = is_failed ? "failed" : "pending";

                result.push_back({
                    .payment_id = payment_id,
                    .type = type,
                    .is_unlocked = false,
                    .block_height = 0,
                    .unlock_time = 0,
                    .timestamp = pd.m_timestamp,
                    .amount = amount - pd.m_change - fee,
                    .tx_hash = epee::string_tools::pod_to_hex(i->first),
                    .fee = fee,
                    .destinations = std::move(destinations),
                    .index_major = pd.m_subaddr_account,
                    // TODO: For ourgoing it can be multiple sub-addresses
                    .index_minor = 0xFFFFFFFF,
                    .note = note,
                });
            }
        }
        sort_payment_details(result);
        return result;
    }

    auto get_payments_mempool()
    {
        return promise(
            [this]()
            { return get_payments_mempool_impl(); },
            [](const std::vector<PaymentDetails> &items) -> emscripten::val
            {
                return vector_to_js_array(items, [](const PaymentDetails &p)
                                          { return payment_details_to_val(p); });
            });
    }

    auto get_transfers()
    {
        return promise(
            [this]()
            {
                tools::wallet2::transfer_container incoming_transfers;
                m_wallet.get_transfers(incoming_transfers);
                return incoming_transfers;
            },
            [](const tools::wallet2::transfer_container &incoming_transfers) -> emscripten::val
            {
                return indexed_to_js_array(incoming_transfers.size(), [&](std::size_t i) -> emscripten::val
                                           {
                                               const auto &td = incoming_transfers[i];
                                               auto item = emscripten::val::object();
                                               item.set("block_height", td.m_block_height);
                                               item.set("txid", epee::string_tools::pod_to_hex(td.m_txid));
                                               item.set("global_output_index", td.m_global_output_index);
                                               item.set("local_output_index", td.m_internal_output_index);
                                               item.set("spent", td.m_spent);
                                               item.set("froze", td.m_frozen);
                                               item.set("spent_height", td.m_spent_height);
                                               item.set("amount", td.m_amount);
                                               item.set("rct", td.m_rct);
                                               item.set("key_image_known", td.m_key_image_known);
                                               item.set("key_image_request", td.m_key_image_request);
                                               item.set("subaddr_index_major", td.m_subaddr_index.major);
                                               item.set("subaddr_index_minor", td.m_subaddr_index.minor);
                                               item.set("key_image_partial", td.m_key_image_partial);
                                               return item;
                                           });
            });
    }

    std::vector<PaymentDetails> get_payments_mempool_impl()
    {
        std::vector<PaymentDetails> result;

        std::vector<std::tuple<cryptonote::transaction, crypto::hash, bool>> process_txs;
        m_wallet.update_pool_state(process_txs);
        if (!process_txs.empty())
            m_wallet.process_pool_state(process_txs);

        std::list<std::pair<crypto::hash, tools::wallet2::pool_payment_details>> payments;
        m_wallet.get_unconfirmed_payments(payments);

        for (auto i = payments.begin(); i != payments.end(); ++i)
        {
            const tools::wallet2::payment_details &pd = i->second.m_pd;
            std::string payment_id = epee::string_tools::pod_to_hex(i->first);

            std::string note = m_wallet.get_tx_note(pd.m_tx_hash);

            std::vector<PaymentDetails::Destination> destinations{
                PaymentDetails::Destination{
                    m_wallet.get_subaddress_as_str({pd.m_subaddr_index.major, pd.m_subaddr_index.minor}),
                    pd.m_amount}};

            std::string double_spend_note;
            if (i->second.m_double_spend_seen)
                double_spend_note = tr("[Double spend seen on the network: this transaction may or may not end up being mined] ");

            result.push_back({
                .payment_id = payment_id,
                .type = "mempool",
                .is_unlocked = false,
                .block_height = pd.m_block_height,
                .unlock_time = 0,
                .timestamp = pd.m_timestamp,
                .amount = pd.m_amount,
                .tx_hash = epee::string_tools::pod_to_hex(pd.m_tx_hash),
                .fee = 0,
                .destinations = std::move(destinations),
                .index_major = pd.m_subaddr_index.major,
                .index_minor = pd.m_subaddr_index.minor,
                .note = note,
            });
        }
        sort_payment_details(result);
        return result;
    }

    auto transfer_prepare(
        emscripten::val dst_addresses_js,
        emscripten::val amounts_js,
        WalletPriorityBacking priority,
        emscripten::val subtract_fee_from_index_js)
    {
        auto dst_addresses = parse_js_array<std::string>(
            dst_addresses_js,
            [](const emscripten::val &item, size_t index) -> std::string
            {
                if (!item.isString())
                {
                    throw std::runtime_error("Expected destination address string at index " + std::to_string(index));
                }
                return item.as<std::string>();
            });
        auto amounts = parse_js_array<uint64_t>(
            amounts_js,
            [](const emscripten::val &item, size_t index) -> uint64_t
            {
                const auto type = item.typeOf().as<std::string>();
                if (type != "number" && type != "bigint")
                {
                    throw std::runtime_error("Expected amount number at index " + std::to_string(index));
                }
                return item.as<uint64_t>();
            });

        if (dst_addresses.empty())
        {
            throw std::runtime_error("Destination addresses list is empty");
        }
        if (dst_addresses.size() != amounts.size())
        {
            throw std::runtime_error("Destination addresses and amounts must have the same length");
        }

        std::optional<size_t> subtract_fee_from_index = std::nullopt;
        if (!subtract_fee_from_index_js.isNull() && !subtract_fee_from_index_js.isUndefined())
        {
            const auto type = subtract_fee_from_index_js.typeOf().as<std::string>();
            if (type == "number")
            {
                const double number_value = subtract_fee_from_index_js.as<double>();
                const double max_size_t_as_double = static_cast<double>(std::numeric_limits<size_t>::max());
                if (!std::isfinite(number_value) ||
                    number_value < 0 ||
                    number_value != std::floor(number_value) ||
                    number_value > max_size_t_as_double)
                {
                    throw std::runtime_error("subtractFeeFromIndex must be a non-negative integer or null");
                }
                subtract_fee_from_index = static_cast<size_t>(number_value);
            }
            else
            {
                throw std::runtime_error("subtractFeeFromIndex must be a number (array index) or null");
            }
        }

        return promise([this, dst_addresses = std::move(dst_addresses), amounts = std::move(amounts), priority, subtract_fee_from_index]()
                       { return register_pending_tx_handle(transfer_impl(dst_addresses, amounts, priority, subtract_fee_from_index)); });
    }

    auto transfer_prepare_sweep_all(
        const std::string &dst_address,
        WalletPriorityBacking priority)
    {
        if (dst_address.empty())
        {
            throw std::runtime_error("Destination address is empty");
        }

        return promise([this, dst_address, priority]()
                       { return register_pending_tx_handle(transfer_sweep_all_impl(dst_address, priority)); });
    }

    auto get_transfers_info(WalletTxHandle handle)
    {
        return promise(
            [this, handle]()
            { return get_transfers_info_impl(*require_pending_tx_handle(handle)); },
            [](const std::vector<PendingTxInfo> &transfers_info) -> emscripten::val
            {
                return vector_to_js_array(transfers_info, [](const PendingTxInfo &transfer_info)
                                          {
                                              auto tx_item = emscripten::val::object();
                                              tx_item.set("fee", transfer_info.fee);
                                              tx_item.set("changeAmount", transfer_info.change_amount);
                                              tx_item.set("destinations", vector_to_js_array(
                                                                              transfer_info.destinations,
                                                                              [](const PendingTxDestinationInfo &destination_info)
                                                                              {
                                                                                  auto dst_item = emscripten::val::object();
                                                                                  dst_item.set("dstAddress", destination_info.dst_address);
                                                                                  dst_item.set("dspAmount", destination_info.dsp_amount);
                                                                                  return dst_item;
                                                                              }));
                                              return tx_item;
                                          });
            });
    }

    auto get_multisig_tx_set_info(WalletTxHandle handle)
    {
        return promise(
            [this, handle]()
            { return get_transfers_info_impl(require_multisig_tx_handle(handle)->m_ptx); },
            [](const std::vector<PendingTxInfo> &transfers_info) -> emscripten::val
            {
                return vector_to_js_array(transfers_info, [](const PendingTxInfo &transfer_info)
                                          {
                                              auto tx_item = emscripten::val::object();
                                              tx_item.set("fee", transfer_info.fee);
                                              tx_item.set("changeAmount", transfer_info.change_amount);
                                              tx_item.set("destinations", vector_to_js_array(
                                                                              transfer_info.destinations,
                                                                              [](const PendingTxDestinationInfo &destination_info)
                                                                              {
                                                                                  auto dst_item = emscripten::val::object();
                                                                                  dst_item.set("dstAddress", destination_info.dst_address);
                                                                                  dst_item.set("dspAmount", destination_info.dsp_amount);
                                                                                  return dst_item;
                                                                              }));
                                              return tx_item;
                                          });
            });
    }

    auto load_multisig_tx(emscripten::val data_js, bool do_accept)
    {
        auto data = parse_js_uint8_array(data_js);
        cryptonote::blobdata blob(reinterpret_cast<const char *>(data.data()), data.size());
        return promise([this, blob = std::move(blob), do_accept]()
                       {
                                auto txs = std::make_shared<tools::wallet2::multisig_tx_set>();
                                if (do_accept)
                                {
                                    bool ok = m_wallet.load_multisig_tx(blob, *txs, [](const tools::wallet2::multisig_tx_set &)
                                                                        { return true; });
                                    if (!ok)
                                    {
                                        throw std::runtime_error("Failed to load multisig tx");
                                    }
                                }
                                else
                                {
                                    tools::wallet2::multisig_tx_set ignored_out;
                                    bool callback_called = false;
                                    m_wallet.load_multisig_tx(blob, ignored_out, [&callback_called, txs](const tools::wallet2::multisig_tx_set &callback_txs)
                                                              {
                                                                  callback_called = true;
                                                                  *txs = callback_txs;
                                                                  return false;
                                                              });
                                    if (!callback_called)
                                    {
                                        throw std::runtime_error("failed to read transaction");
                                    }
                                }
                                return register_multisig_tx_handle(txs); });
    }

    auto sign_multisig_tx(WalletTxHandle handle)
    {
        return promise(
            [this, handle]()
            {
                auto multisig_tx_set = require_multisig_tx_handle(handle);
                std::vector<crypto::hash> txids_hashes;
                bool ok = m_wallet.sign_multisig_tx(*multisig_tx_set, txids_hashes);
                if (!ok)
                {
                    throw std::runtime_error("Failed to sign multisig tx");
                }
                auto txids = std::vector<std::string>{};
                txids.reserve(txids_hashes.size());
                for (const auto &txid : txids_hashes)
                {
                    txids.push_back(epee::string_tools::pod_to_hex(txid));
                }
                return txids;
            },
            [](const std::vector<std::string> &txids) -> emscripten::val
            {
                return vector_to_js_array(txids, [](const std::string &s)
                                          { return emscripten::val(s); });
            });
    }

    auto save_multisig_tx(WalletTxHandle handle)
    {
        return promise(
            [this, handle]()
            { return m_wallet.save_multisig_tx(*require_multisig_tx_handle(handle)); },
            [](const std::string &ciphertext) -> emscripten::val
            {
                auto *bytes = reinterpret_cast<const std::uint8_t *>(ciphertext.data());
                return MoneroWasmWallet::copy_bytes_to_uint8_array(bytes, ciphertext.size());
            });
    }

    auto get_multisig_tx_signers_count(WalletTxHandle handle, bool exclude_self)
    {
        return promise(
            [this, handle, exclude_self]()
            {
                auto multisig_tx_set = require_multisig_tx_handle(handle);
                if (exclude_self &&
                    multisig_tx_set->m_signers.find(m_wallet.get_multisig_signer_public_key()) != multisig_tx_set->m_signers.end())
                {
                    return multisig_tx_set->m_signers.size() - 1;
                }
                return multisig_tx_set->m_signers.size();
            });
    }

    auto transfer_commit_tx_multisig(WalletTxHandle handle)
    {
        return promise_void([this, handle]()
                            {
                                m_wallet.commit_tx(require_multisig_tx_handle(handle)->m_ptx); });
    }

    std::vector<PendingTxInfo> get_transfers_info_impl(const std::vector<tools::wallet2::pending_tx> &ptx_vector)
    {
        std::vector<PendingTxInfo> result;
        result.reserve(ptx_vector.size());

        for (const auto &ptx : ptx_vector)
        {
            std::vector<PendingTxDestinationInfo> destinations;
            destinations.reserve(ptx.dests.size());

            for (const auto &dst : ptx.dests)
            {
                destinations.push_back(PendingTxDestinationInfo{
                    .dst_address = cryptonote::get_account_address_as_str(m_wallet.nettype(), dst.is_subaddress, dst.addr),
                    .dsp_amount = dst.amount});
            }

            result.push_back(PendingTxInfo{
                .fee = ptx.fee,
                .change_amount = ptx.change_dts.amount,
                .destinations = std::move(destinations)});
        }
        return result;
    }

    auto transfer_commit_tx(WalletTxHandle handle)
    {
        return promise_void([this, handle]()
                            {
                                m_wallet.commit_tx(*require_pending_tx_handle(handle)); });
    }

    auto save_multisig_tx_pending_tx(WalletTxHandle handle)
    {
        return promise(
            [this, handle]()
            {
                auto status = get_multisig_status_compat();
                if (!status.multisig_is_active)
                {
                    throw std::runtime_error("Wallet is not multisig");
                }
                if (!status.is_ready)
                {
                    throw std::runtime_error("Multisig wallet is not ready");
                }
                return m_wallet.save_multisig_tx(*require_pending_tx_handle(handle));
            },
            [](const std::string &ciphertext) -> emscripten::val
            {
                auto *bytes = reinterpret_cast<const std::uint8_t *>(ciphertext.data());
                return MoneroWasmWallet::copy_bytes_to_uint8_array(bytes, ciphertext.size());
            });
    }

    auto destroyTxHandle(WalletTxHandle handle)
    {
        return promise_void([this, handle]()
                            { destroy_tx_handle_impl(handle); });
    }

    WalletTxHandle register_pending_tx_handle(std::shared_ptr<std::vector<tools::wallet2::pending_tx>> tx_handle)
    {
        const auto handle = allocate_tx_handle();
        m_pending_tx_handles.emplace(handle, std::move(tx_handle));
        return handle;
    }

    WalletTxHandle register_multisig_tx_handle(std::shared_ptr<tools::wallet2::multisig_tx_set> tx_handle)
    {
        const auto handle = allocate_tx_handle();
        m_multisig_tx_handles.emplace(handle, std::move(tx_handle));
        return handle;
    }

    WalletTxHandle allocate_tx_handle()
    {
        while (m_tx_handles.count(m_next_tx_handle) > 0 || m_next_tx_handle == 0)
        {
            ++m_next_tx_handle;
        }
        const auto handle = m_next_tx_handle++;
        m_tx_handles.insert(handle);
        return handle;
    }

    std::shared_ptr<std::vector<tools::wallet2::pending_tx>> require_pending_tx_handle(WalletTxHandle handle)
    {
        const auto it = m_pending_tx_handles.find(handle);
        if (it == m_pending_tx_handles.end())
        {
            throw std::runtime_error("Pending transaction handle is not available");
        }
        return it->second;
    }

    std::shared_ptr<tools::wallet2::multisig_tx_set> require_multisig_tx_handle(WalletTxHandle handle)
    {
        const auto it = m_multisig_tx_handles.find(handle);
        if (it == m_multisig_tx_handles.end())
        {
            throw std::runtime_error("Multisig transaction handle is not available");
        }
        return it->second;
    }

    void destroy_tx_handle_impl(WalletTxHandle handle)
    {
        m_tx_handles.erase(handle);
        m_pending_tx_handles.erase(handle);
        m_multisig_tx_handles.erase(handle);
    }

    void destroy_all_tx_handles_impl()
    {
        m_tx_handles.clear();
        m_pending_tx_handles.clear();
        m_multisig_tx_handles.clear();
    }

    std::shared_ptr<std::vector<tools::wallet2::pending_tx>> transfer_impl(
        const std::vector<std::string> &dst_addresses,
        const std::vector<uint64_t> &amounts,
        WalletPriorityBacking priority,
        std::optional<size_t> subtract_fee_from_index)
    {
        if (dst_addresses.empty())
        {
            throw std::runtime_error("Destination addresses list is empty");
        }
        if (dst_addresses.size() != amounts.size())
        {
            throw std::runtime_error("Destination addresses and amounts must have the same length");
        }

        std::vector<cryptonote::tx_destination_entry> dsts;
        dsts.reserve(dst_addresses.size());

        for (size_t i = 0; i < dst_addresses.size(); ++i)
        {
            cryptonote::address_parse_info info;
            auto r = cryptonote::get_account_address_from_str(info, m_wallet.nettype(), dst_addresses[i]);
            if (!r)
            {
                throw std::runtime_error("Invalid destination address at index " + std::to_string(i));
            };

            cryptonote::tx_destination_entry de;
            de.addr = info.address;
            de.is_subaddress = info.is_subaddress;
            de.is_integrated = info.has_payment_id;
            de.amount = amounts[i];

            dsts.push_back(de);
        }

        tools::wallet2::unique_index_container subtract_fee_from_outputs;
        if (subtract_fee_from_index.has_value())
        {
            if (*subtract_fee_from_index >= dsts.size())
            {
                throw std::runtime_error("subtractFeeFromIndex is out of bounds");
            }
            subtract_fee_from_outputs.insert(*subtract_fee_from_index);
        }

        const size_t min_ring_size = m_wallet.get_min_ring_size();
        size_t fake_outs_count = min_ring_size - 1;

        std::vector<uint8_t> extra;
        std::set<uint32_t> subaddr_indices;

        auto ptx_vector = m_wallet.create_transactions_2(dsts, fake_outs_count,
                                                         static_cast<uint32_t>(priority),
                                                         extra,
                                                         0, subaddr_indices, subtract_fee_from_outputs);
        if (ptx_vector.empty())
        {
            throw std::runtime_error("No outputs found, or daemon is not ready");
        }

        return std::make_shared<std::vector<tools::wallet2::pending_tx>>(std::move(ptx_vector));
    }

    std::shared_ptr<std::vector<tools::wallet2::pending_tx>> transfer_sweep_all_impl(
        const std::string &dst_address,
        WalletPriorityBacking priority)
    {
        cryptonote::address_parse_info info;
        const auto is_valid = cryptonote::get_account_address_from_str(
            info, m_wallet.nettype(), dst_address);
        if (!is_valid)
        {
            throw std::runtime_error("Invalid destination address");
        }

        const size_t min_ring_size = m_wallet.get_min_ring_size();
        const size_t fake_outs_count = min_ring_size - 1;

        std::vector<uint8_t> extra;
        std::set<uint32_t> subaddr_indices;

        auto ptx_vector = m_wallet.create_transactions_all(
            0,
            info.address,
            info.is_subaddress,
            1,
            fake_outs_count,
            static_cast<uint32_t>(priority),
            extra,
            0,
            subaddr_indices);
        if (ptx_vector.empty())
        {
            throw std::runtime_error("No outputs found, or daemon is not ready");
        }

        return std::make_shared<std::vector<tools::wallet2::pending_tx>>(std::move(ptx_vector));
    }

    auto get_wallet_file()
    {
        return promise([this]()
                       { return m_wallet.get_wallet_file(); });
    }

    auto get_tx_proof(const std::string &txid_str, const std::string &dstaddress, const std::string &note)
    {
        return promise([this, txid_str, dstaddress, note]()
                       {
                           crypto::hash txid;
                           if (!epee::string_tools::hex_to_pod(txid_str, txid))
                           {
                               throw std::runtime_error("TX ID has invalid format");
                           }

                           cryptonote::address_parse_info info;
                           if (!cryptonote::get_account_address_from_str(info, m_wallet.nettype(), dstaddress))
                           {
                               throw std::runtime_error("Invalid destination address");
                           }

                           return m_wallet.get_tx_proof(txid, info.address, info.is_subaddress, note); });
    }

    auto get_tx_key(const std::string &txid_str)
    {
        return promise([this, txid_str]()
                       {
                           crypto::hash txid;
                           if (!epee::string_tools::hex_to_pod(txid_str, txid))
                           {
                               throw std::runtime_error("TX ID has invalid format");
                           }

                           crypto::secret_key tx_key = crypto::null_skey;
                           std::vector<crypto::secret_key> additional_tx_keys;
                           if (!m_wallet.get_tx_key(txid, tx_key, additional_tx_keys))
                           {
                               throw std::runtime_error("Tx secret key wasn't found in the wallet file.");
                           }

                           std::string keys = epee::string_tools::pod_to_hex(unwrap(unwrap(tx_key)));
                           for (const auto &key : additional_tx_keys)
                           {
                               keys += epee::string_tools::pod_to_hex(unwrap(unwrap(key)));
                           }
                           return keys; });
    }

    auto get_tx_keys_for_address(const std::string &txid_str, const std::string &dstaddress)
    {
        return promise(
            [this, txid_str, dstaddress]()
            {
                crypto::hash txid;
                if (!epee::string_tools::hex_to_pod(txid_str, txid))
                {
                    throw std::runtime_error("TX ID has invalid format");
                }

                cryptonote::address_parse_info info;
                if (!cryptonote::get_account_address_from_str(info, m_wallet.nettype(), dstaddress))
                {
                    throw std::runtime_error("Invalid destination address");
                }

                crypto::secret_key tx_key = crypto::null_skey;
                std::vector<crypto::secret_key> additional_tx_keys;
                if (!m_wallet.get_tx_key(txid, tx_key, additional_tx_keys))
                {
                    throw std::runtime_error("Tx secret key wasn't found in the wallet file.");
                }

                std::vector<crypto::secret_key> candidate_keys;
                candidate_keys.reserve(1 + additional_tx_keys.size());
                candidate_keys.push_back(tx_key);
                for (const auto &key : additional_tx_keys)
                {
                    candidate_keys.push_back(key);
                }

                std::vector<std::string> matching_keys;
                for (const auto &candidate : candidate_keys)
                {
                    uint64_t received = 0;
                    bool in_pool = false;
                    uint64_t confirmations = 0;
                    m_wallet.check_tx_key(txid, candidate, {}, info.address, received, in_pool, confirmations);
                    if (received > 0)
                    {
                        matching_keys.push_back(epee::string_tools::pod_to_hex(unwrap(unwrap(candidate))));
                    }
                }

                if (matching_keys.empty())
                {
                    throw std::runtime_error("No tx key was found for this destination address");
                }
                return matching_keys;
            },
            [](const std::vector<std::string> &keys) -> emscripten::val
            {
                auto result = emscripten::val::array();
                for (size_t i = 0; i < keys.size(); ++i)
                {
                    result.set(static_cast<uint32_t>(i), keys[i]);
                }
                return result;
            });
    }

    auto balance(uint32_t index_major, bool strict)
    {
        return promise([this, index_major, strict]()
                       { return m_wallet.balance(index_major, strict); });
    }

    auto set_refresh_from_block_height(uint64_t height)
    {
        return promise([this, height]()
                       {
                           m_wallet.set_refresh_from_block_height(height);
                           return true; });
    }

    auto set_explicit_refresh_from_block_height(bool value)
    {
        return promise([this, value]()
                       {
                           m_wallet.explicit_refresh_from_block_height(value);
                           return true; });
    }

    auto get_blockchain_current_height()
    {
        return promise([this]()
                       { return m_wallet.get_blockchain_current_height(); });
    }

    struct UnlockedBalanceResult
    {
        uint64_t balance;
        uint64_t blocks_to_unlock;
        uint64_t time_to_unlock;
    };

    auto unlocked_balance(uint32_t index_major, bool strict)
    {
        return promise([this, index_major, strict]()
                       {
                           auto r = UnlockedBalanceResult{};
                           r.balance = m_wallet.unlocked_balance(index_major, strict, &r.blocks_to_unlock, &r.time_to_unlock);
                           return r; });
    }

    auto get_blockchain_height_by_date(uint16_t year, uint8_t month, uint8_t day)
    {
        return promise([this, year, month, day]()
                       { return m_wallet.get_blockchain_height_by_date(year, month, day); });
    }

    auto get_multisig_status()
    {
        return promise([this]()
                       { return get_multisig_status_compat(); });
    }

    auto has_multisig_partial_key_images()
    {
        return promise([this]()
                       { return m_wallet.has_multisig_partial_key_images(); });
    }

    auto has_unknown_key_images()
    {
        return promise([this]()
                       { return m_wallet.has_unknown_key_images(); });
    }

    auto verify_password(const std::string &password_str)
    {
        epee::wipeable_string password(password_str);
        return promise([this, password]()
                       { return m_wallet.verify_password(password); });
    }

    auto make_multisig(const std::string &password_str,
                       emscripten::val initial_kex_msgs_js,
                       std::uint32_t threshold)
    {
        epee::wipeable_string password(password_str);
        auto initial_kex_msgs = parse_js_array<std::string>(
            initial_kex_msgs_js,
            [](const emscripten::val &item, size_t index) -> std::string
            {
                if (!item.isString())
                {
                    throw std::runtime_error("Expected string at index " + std::to_string(index));
                }
                return item.as<std::string>();
            });

        return promise([this, password, initial_kex_msgs = std::move(initial_kex_msgs), threshold]()
                       {
                           if (!m_wallet.verify_password(password))
                           {
                               throw std::runtime_error("invalid password");
                           }

                           if (get_multisig_status_compat().multisig_is_active)
                           {
                               throw std::runtime_error("Wallet is already multisig");
                           };
                           if (m_wallet.get_num_transfer_details())
                           {
                               throw std::runtime_error("Wallet must be empty to create multisig");
                           };
                           return m_wallet.make_multisig(password, initial_kex_msgs, threshold); });
    }

    auto exchange_multisig_keys(const std::string &password_str, emscripten::val kex_msgs_js)
    {
        epee::wipeable_string password(password_str);
        auto kex_msgs = parse_js_array<std::string>(
            kex_msgs_js,
            [](const emscripten::val &item, size_t index) -> std::string
            {
                if (!item.isString())
                {
                    throw std::runtime_error("Expected string at index " + std::to_string(index));
                }
                return item.as<std::string>();
            });

        return promise([this, password, kex_msgs = std::move(kex_msgs)]()
                       {
                           if (!m_wallet.verify_password(password))
                           {
                               throw std::runtime_error("invalid password");
                           }
                           if (!get_multisig_status_compat().multisig_is_active)
                           {
                               throw std::runtime_error("Wallet is not multisig");
                           };
                           return m_wallet.exchange_multisig_keys(password, kex_msgs); });
    }

    auto prepare_multisig()
    {
        return promise([this]()
                       {
                           if (m_wallet.get_num_transfer_details() > 0)
                           {
                               throw std::runtime_error("Wallet must be empty to prepare multisig");
                           }
                           if (get_multisig_status_compat().multisig_is_active)
                           {
                               throw std::runtime_error("Wallet is already multisig");
                           }
                           return m_wallet.get_multisig_first_kex_msg(); });
    }

    auto enable_multisig(bool enable)
    {
        return promise([this, enable]()
                       {
                           m_wallet.enable_multisig(enable);
                           return true;
                       });
    }

    auto export_multisig()
    {
        return promise(
            [this]()
            {
                auto status = get_multisig_status_compat();
                if (!status.multisig_is_active)
                {
                    throw std::runtime_error("Wallet is not multisig");
                }
                if (!status.is_ready)
                {
                    throw std::runtime_error("Multisig wallet is not ready");
                }
                return m_wallet.export_multisig();
            },
            [](const cryptonote::blobdata &ciphertext) -> emscripten::val
            {
                auto *bytes = reinterpret_cast<const std::uint8_t *>(ciphertext.data());
                return MoneroWasmWallet::copy_bytes_to_uint8_array(bytes, ciphertext.size());
            });
    }

    auto import_multisig(emscripten::val others_multisig_info_js)
    {

        auto info_uint = parse_js_uint8_array_array(others_multisig_info_js);
        std::vector<cryptonote::blobdata> info;
        info.reserve(info_uint.size());
        for (const auto &i : info_uint)
        {
            info.emplace_back(reinterpret_cast<const char *>(i.data()), i.size());
        }
        return promise(
            [this, info = std::move(info)]()
            {
                auto status = get_multisig_status_compat();
                if (!status.multisig_is_active)
                {
                    throw std::runtime_error("Wallet is not multisig");
                }
                if (!status.is_ready)
                {
                    throw std::runtime_error("Multisig wallet is not ready");
                }
                if (info.size() + 1 < status.threshold)
                {
                    throw std::runtime_error("Not enough multisig info provided");
                }
                size_t n_outputs = m_wallet.import_multisig(info);
                return n_outputs;
            });
    }

    auto export_key_images(const std::string &filename, bool all)
    {
        return promise([this, filename, all]()
                       {
                           if (m_wallet.key_on_device())
                           {
                               throw std::runtime_error("command not supported by HW wallet");
                           }
                           if (m_wallet.watch_only())
                           {
                               throw std::runtime_error("wallet is watch-only and cannot export key images");
                           }

                           if (!m_wallet.export_key_images(filename, all))
                           {
                               throw std::runtime_error("failed to save file " + filename);
                           }
                           return true;
                       });
    }

    auto import_key_images(const std::string &filename, bool import_when_untrusted_daemon)
    {
        return promise([this, filename, import_when_untrusted_daemon]()
                       {
                           if (m_wallet.key_on_device())
                           {
                               throw std::runtime_error("command not supported by HW wallet");
                           }
                           if (!m_wallet.is_trusted_daemon() && !import_when_untrusted_daemon)
                           {
                               throw std::runtime_error("this command requires a trusted daemon");
                           }

                           KeyImagesImportResult result{};
                           result.height = m_wallet.import_key_images(filename, result.spent, result.unspent);
                           return result;
                       });
    }

    auto rescan_blockchain(bool hard, bool keep_key_images)
    {
        return promise([this, hard, keep_key_images]()
                       {
                           m_wallet.rescan_blockchain(hard, false, keep_key_images);
                           return true; });
    }

private:
    MultisigStatus get_multisig_status_compat() const
    {
        const auto state = m_wallet.get_multisig_wallet_state();
        uint32_t threshold = 0;
        uint32_t total = 0;
        const bool multisig = m_wallet.multisig(nullptr, &threshold, &total);
        return MultisigStatus{
            multisig,
            state.multisig_rounds_passed > 0,
            state.multisig_is_ready,
            state.multisig_rounds_passed,
            threshold,
            total,
        };
    }

    static emscripten::val payment_details_to_val(const PaymentDetails &p)
    {
        auto o = emscripten::val::object();
        o.set("payment_id", p.payment_id);
        o.set("type", p.type);
        o.set("is_unlocked", p.is_unlocked);
        o.set("block_height", p.block_height);
        o.set("unlock_time", p.unlock_time);
        o.set("timestamp", p.timestamp);
        o.set("amount", p.amount);
        o.set("tx_hash", p.tx_hash);
        o.set("fee", p.fee);
        o.set("destinations", vector_to_js_array(p.destinations, [](const PaymentDetails::Destination &destination)
                                                 {
                                                     auto item = emscripten::val::object();
                                                     item.set("address", destination.address);
                                                     item.set("amount", destination.amount);
                                                     return item;
                                                 }));
        o.set("index_major", p.index_major);
        o.set("index_minor", p.index_minor);
        o.set("note", p.note);
        return o;
    }

    static void sort_payment_details(std::vector<PaymentDetails> &payments)
    {
        std::sort(payments.begin(), payments.end(), [](const PaymentDetails &a, const PaymentDetails &b)
                  {
                      const bool a_pending = a.type == "pending";
                      const bool b_pending = b.type == "pending";
                      if (a_pending != b_pending)
                      {
                          return a_pending;
                      }
                      if (a_pending)
                      {
                          return a.timestamp > b.timestamp;
                      }
                      if (a.block_height != b.block_height)
                      {
                          return a.block_height > b.block_height;
                      }
                      return a.timestamp > b.timestamp;
                  });
    }

    static emscripten::val wallet_address_to_val(const WalletAddress &wa)
    {
        auto o = emscripten::val::object();
        o.set("address", wa.address);
        o.set("label", wa.label);
        o.set("indexMinor", wa.indexMinor);
        return o;
    }

    template <typename T, typename ParseItemFn>
    static std::vector<T> parse_js_array(const emscripten::val &js_array, ParseItemFn &&parse_item)
    {
        if (!js_array.instanceof(emscripten::val::global("Array")))
        {
            throw std::runtime_error("Expected array");
        }

        const auto len = js_array["length"].as<size_t>();
        auto out = std::vector<T>{};
        out.reserve(len);
        for (size_t i = 0; i < len; ++i)
        {
            out.push_back(parse_item(js_array[i], i));
        }
        return out;
    }

    static std::vector<std::uint8_t> parse_js_uint8_array(const emscripten::val &js_uint8_array)
    {
        if (!js_uint8_array.instanceof(emscripten::val::global("Uint8Array")))
        {
            throw std::runtime_error("Expected Uint8Array");
        }

        const auto len = js_uint8_array["length"].as<size_t>();
        auto out = std::vector<std::uint8_t>(len);
        if (len > 0)
        {
            auto out_view = emscripten::val(emscripten::typed_memory_view(len, out.data()));
            out_view.call<void>("set", js_uint8_array);
        }
        return out;
    }

    static void copy_js_uint8_array_to(const emscripten::val &js_uint8_array, unsigned char *out, size_t expected_len)
    {
        if (!js_uint8_array.instanceof(emscripten::val::global("Uint8Array")))
        {
            throw std::runtime_error("Expected Uint8Array");
        }

        const auto len = js_uint8_array["length"].as<size_t>();
        if (len != expected_len)
        {
            throw std::runtime_error("Expected " + std::to_string(expected_len) + " bytes but got " + std::to_string(len));
        }

        if (expected_len > 0)
        {
            auto out_view = emscripten::val(emscripten::typed_memory_view(expected_len, out));
            out_view.call<void>("set", js_uint8_array);
        }
    }

    static void validate_js_uint8_array_len(const emscripten::val &js_uint8_array, size_t expected_len, const char *field_name)
    {
        if (!js_uint8_array.instanceof(emscripten::val::global("Uint8Array")))
        {
            throw std::runtime_error(std::string(field_name) + " must be Uint8Array");
        }

        const auto len = js_uint8_array["length"].as<size_t>();
        if (len != expected_len)
        {
            throw std::runtime_error(
                std::string(field_name) + " must be " + std::to_string(expected_len) + " bytes, got " + std::to_string(len));
        }
    }

    static std::vector<std::vector<std::uint8_t>> parse_js_uint8_array_array(const emscripten::val &js_array)
    {
        return parse_js_array<std::vector<std::uint8_t>>(
            js_array,
            [&](const emscripten::val &item, size_t /*index*/) -> std::vector<std::uint8_t>
            {
                return parse_js_uint8_array(item);
            });
    }

    static emscripten::val copy_bytes_to_uint8_array(const std::uint8_t *data, size_t size)
    {
        auto out = emscripten::val::global("Uint8Array").new_(size);
        if (size == 0)
        {
            return out;
        }

        // Copy in one call to avoid per-byte embind overhead for large buffers.
        out.call<void>("set", emscripten::val(emscripten::typed_memory_view(size, data)));
        return out;
    }

    template <class WorkFn, class PackFn>
    emscripten::val promise(WorkFn &&work, PackFn &&pack_to_js)
    {
        using ResultT = std::decay_t<std::invoke_result_t<WorkFn>>;
        static_assert(!std::is_void_v<ResultT>, "promise() requires non-void return type");

        auto p = makePromise();
        auto result = std::make_shared<std::optional<ResultT>>();
        auto error = std::make_shared<std::optional<std::string>>();

        walletQueue.proxyCallback(
            walletThread,
            [work = std::forward<WorkFn>(work), result, error]() mutable
            {
                try
                {
                    result->emplace(work());
                }
                catch (const std::exception &e)
                {
                    *error = e.what();
                }
                catch (...)
                {
                    *error = "Unknown error";
                }
            },
            [p, result, error, pack_to_js = std::forward<PackFn>(pack_to_js)]()
            {
                if (error->has_value())
                {
                    p.reject(jsError(error->value()));
                    return;
                }
                p.resolve(pack_to_js(result->value()));
            },
            [p]()
            {
                p.reject(jsError("Thread error"));
            });

        return p.promise;
    }

    template <class WorkFn>
    emscripten::val promise(WorkFn &&work)
    {
        using ResultT = std::decay_t<std::invoke_result_t<WorkFn>>;
        return promise(
            std::forward<WorkFn>(work),
            [](const ResultT &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

    template <class WorkFn>
    emscripten::val promise_void(WorkFn &&work)
    {
        auto p = makePromise();
        auto error = std::make_shared<std::optional<std::string>>();

        walletQueue.proxyCallback(
            walletThread,
            [work = std::forward<WorkFn>(work), error]()
            {
                try
                {
                    work();
                }
                catch (const std::exception &e)
                {
                    *error = e.what();
                }
                catch (...)
                {
                    *error = "Unknown error";
                }
            },
            [p, error]()
            {
                if (error->has_value())
                {
                    p.reject(jsError(error->value()));
                    return;
                }
                p.resolve(emscripten::val::undefined());
            },
            [p]()
            {
                p.reject(jsError("Thread error"));
            });

        return p.promise;
    }

    tools::wallet2 m_wallet;
    WalletTxHandle m_next_tx_handle = 1;
    std::set<WalletTxHandle> m_tx_handles;
    std::map<WalletTxHandle, std::shared_ptr<std::vector<tools::wallet2::pending_tx>>> m_pending_tx_handles;
    std::map<WalletTxHandle, std::shared_ptr<tools::wallet2::multisig_tx_set>> m_multisig_tx_handles;

    pthread_t walletThread;
    emscripten::ProxyingQueue walletQueue;

    // Assuming that constructor is called in the main thread
    pthread_t mainThread = pthread_self();
    emscripten::ProxyingQueue mainThreadQueue;

    emscripten::val m_on_new_block_callback = emscripten::val::null();
};

EMSCRIPTEN_BINDINGS(monero_wasm_wallet)
{
    // emscripten::enum_ for network_type is intentionally disabled.
    // We expose the raw backing type (uint8_t) over the JS boundary instead.

    emscripten::class_<MoneroWasmWallet>("MoneroWasmWallet")
        .function("init", &MoneroWasmWallet::init)
        .function("get_daemon_blockchain_height", &MoneroWasmWallet::get_daemon_blockchain_height)
        .function("generate", &MoneroWasmWallet::generate)
        .function("generate_multisig_restore", &MoneroWasmWallet::generate_multisig_restore)
        .function("generate_from_keys", &MoneroWasmWallet::generate_from_keys)
        .function("generate_view_only_from_keys", &MoneroWasmWallet::generate_view_only_from_keys)
        .function("rewrite", &MoneroWasmWallet::rewrite)
        .function("close_wallet", &MoneroWasmWallet::close_wallet)
        .function("get_address", &MoneroWasmWallet::get_address)
        .function("get_network_type", &MoneroWasmWallet::get_network_type)
        .function("allow_mismatched_daemon_version", &MoneroWasmWallet::allow_mismatched_daemon_version)
        .function("watch_only", &MoneroWasmWallet::watch_only)
        .function("is_deterministic", &MoneroWasmWallet::is_deterministic)
        .function("get_keys", &MoneroWasmWallet::get_keys)
        .function("get_num_subaddresses", &MoneroWasmWallet::get_num_subaddresses)
        .function("get_subaddress_as_str", &MoneroWasmWallet::get_subaddress_as_str)
        .function("get_subaddress_label", &MoneroWasmWallet::get_subaddress_label)
        .function("get_wallet_addresses", &MoneroWasmWallet::get_wallet_addresses)
        .function("add_subaddress", &MoneroWasmWallet::add_subaddress)
        .function("is_synced", &MoneroWasmWallet::is_synced)
        .function("set_on_new_block_callback", &MoneroWasmWallet::set_on_new_block_callback)
        .function("refresh", &MoneroWasmWallet::refresh)
        .function("load", &MoneroWasmWallet::load)
        .function("get_transfers", &MoneroWasmWallet::get_transfers)
        .function("get_payments", &MoneroWasmWallet::get_payments)
        .function("get_payments_mempool", &MoneroWasmWallet::get_payments_mempool)
        .function("store", &MoneroWasmWallet::store)
        .function("set_attribute", &MoneroWasmWallet::set_attribute)
        .function("get_attribute", &MoneroWasmWallet::get_attribute)
        .function("get_seed", &MoneroWasmWallet::get_seed)
        .function("get_multisig_seed", &MoneroWasmWallet::get_multisig_seed)
        .function("get_wallet_file", &MoneroWasmWallet::get_wallet_file)
        .function("get_tx_proof", &MoneroWasmWallet::get_tx_proof)
        .function("get_tx_key", &MoneroWasmWallet::get_tx_key)
        .function("get_tx_keys_for_address", &MoneroWasmWallet::get_tx_keys_for_address)
        .function("balance", &MoneroWasmWallet::balance)
        .function("unlocked_balance", &MoneroWasmWallet::unlocked_balance)
        .function("set_refresh_from_block_height", &MoneroWasmWallet::set_refresh_from_block_height)
        .function("set_explicit_refresh_from_block_height", &MoneroWasmWallet::set_explicit_refresh_from_block_height)
        .function("get_blockchain_current_height", &MoneroWasmWallet::get_blockchain_current_height)
        .function("get_blockchain_height_by_date", &MoneroWasmWallet::get_blockchain_height_by_date)
        .function("words_to_bytes", &MoneroWasmWallet::words_to_bytes)
        .function("transfer_prepare", &MoneroWasmWallet::transfer_prepare)
        .function("transfer_prepare_sweep_all", &MoneroWasmWallet::transfer_prepare_sweep_all)
        .function("get_transfers_info", &MoneroWasmWallet::get_transfers_info)
        .function("transfer_commit_tx", &MoneroWasmWallet::transfer_commit_tx)
        .function("save_multisig_tx_pending_tx", &MoneroWasmWallet::save_multisig_tx_pending_tx)
        .function("load_multisig_tx", &MoneroWasmWallet::load_multisig_tx)
        .function("get_multisig_tx_set_info", &MoneroWasmWallet::get_multisig_tx_set_info)
        .function("get_multisig_tx_signers_count", &MoneroWasmWallet::get_multisig_tx_signers_count)
        .function("sign_multisig_tx", &MoneroWasmWallet::sign_multisig_tx)
        .function("save_multisig_tx", &MoneroWasmWallet::save_multisig_tx)
        .function("transfer_commit_tx_multisig", &MoneroWasmWallet::transfer_commit_tx_multisig)
        .function("get_multisig_status", &MoneroWasmWallet::get_multisig_status)
        .function("has_multisig_partial_key_images", &MoneroWasmWallet::has_multisig_partial_key_images)
        .function("has_unknown_key_images", &MoneroWasmWallet::has_unknown_key_images)
        .function("enable_multisig", &MoneroWasmWallet::enable_multisig)
        .function("prepare_multisig", &MoneroWasmWallet::prepare_multisig)
        .function("make_multisig", &MoneroWasmWallet::make_multisig)
        .function("exchange_multisig_keys", &MoneroWasmWallet::exchange_multisig_keys)
        .function("export_multisig", &MoneroWasmWallet::export_multisig)
        .function("import_multisig", &MoneroWasmWallet::import_multisig)
        .function("export_key_images", &MoneroWasmWallet::export_key_images)
        .function("import_key_images", &MoneroWasmWallet::import_key_images)
        .function("verify_password", &MoneroWasmWallet::verify_password)
        .function("rescan_blockchain", &MoneroWasmWallet::rescan_blockchain)
        .function("destroyTxHandle", &MoneroWasmWallet::destroyTxHandle)
        .constructor<WalletNetworkTypeBacking>();

    emscripten::value_object<MoneroWasmWallet::MultisigStatus>("MultisigAccountStatus")
        .field("multisig_is_active", &MoneroWasmWallet::MultisigStatus::multisig_is_active)
        .field("kex_is_done", &MoneroWasmWallet::MultisigStatus::kex_is_done)
        .field("is_ready", &MoneroWasmWallet::MultisigStatus::is_ready)
        .field("multisig_rounds_passed", &MoneroWasmWallet::MultisigStatus::multisig_rounds_passed)
        .field("threshold", &MoneroWasmWallet::MultisigStatus::threshold)
        .field("total", &MoneroWasmWallet::MultisigStatus::total);

    /*
emscripten::class_<tools::wallet2::transfer_details>("TransferDetails")
    .property("m_block_height", &tools::wallet2::transfer_details::m_block_height)
    .function("amount", &tools::wallet2::transfer_details::amount);


emscripten::value_object<tools::wallet2::transfer_details>("TransferDetails")
        .field("m_block_height", &tools::wallet2::transfer_details::m_block_height)
        .field("m_amount", &tools::wallet2::transfer_details::m_amount);

emscripten::register_vector<tools::wallet2::transfer_details>("TransferDetailsVector");
*/
    emscripten::value_object<struct MoneroWasmWallet::PaymentDetails>("PaymentDetails")
        .field("payment_id", &MoneroWasmWallet::PaymentDetails::payment_id)
        .field("type", &MoneroWasmWallet::PaymentDetails::type)
        .field("is_unlocked", &MoneroWasmWallet::PaymentDetails::is_unlocked)
        .field("block_height", &MoneroWasmWallet::PaymentDetails::block_height)
        .field("unlock_time", &MoneroWasmWallet::PaymentDetails::unlock_time)
        .field("timestamp", &MoneroWasmWallet::PaymentDetails::timestamp)
        .field("amount", &MoneroWasmWallet::PaymentDetails::amount)
        .field("tx_hash", &MoneroWasmWallet::PaymentDetails::tx_hash)
        .field("fee", &MoneroWasmWallet::PaymentDetails::fee)
        .field("index_major", &MoneroWasmWallet::PaymentDetails::index_major)
        .field("index_minor", &MoneroWasmWallet::PaymentDetails::index_minor)
        .field("note", &MoneroWasmWallet::PaymentDetails::note);

    emscripten::value_object<struct MoneroWasmWallet::WalletAddress>("WalletAddress")
        .field("address", &MoneroWasmWallet::WalletAddress::address)
        .field("label", &MoneroWasmWallet::WalletAddress::label)
        .field("indexMinor", &MoneroWasmWallet::WalletAddress::indexMinor);

    emscripten::value_object<MoneroWasmWallet::RefreshResult>("RefreshResult")
        .field("blocksFetched", &MoneroWasmWallet::RefreshResult::blocksFetched)
        .field("receivedMoney", &MoneroWasmWallet::RefreshResult::receivedMoney);

    emscripten::value_object<MoneroWasmWallet::UnlockedBalanceResult>("UnlockedBalanceResult")
        .field("balance", &MoneroWasmWallet::UnlockedBalanceResult::balance)
        .field("blocks_to_unlock", &MoneroWasmWallet::UnlockedBalanceResult::blocks_to_unlock)
        .field("time_to_unlock", &MoneroWasmWallet::UnlockedBalanceResult::time_to_unlock);

    emscripten::value_object<MoneroWasmWallet::KeyImagesImportResult>("KeyImagesImportResult")
        .field("height", &MoneroWasmWallet::KeyImagesImportResult::height)
        .field("spent", &MoneroWasmWallet::KeyImagesImportResult::spent)
        .field("unspent", &MoneroWasmWallet::KeyImagesImportResult::unspent);

    emscripten::function(
        "mlog_set_categories",
        emscripten::optional_override([](std::string categories) -> void
                                      { mlog_set_categories(categories.c_str()); }));
    emscripten::function(
        "set_max_concurrency",
        emscripten::optional_override([](uint32_t threads) -> void
                                      { tools::set_max_concurrency(std::max<uint32_t>(1, threads)); }));
    emscripten::function(
        "get_monero_version_full",
        emscripten::optional_override([]() -> std::string
                                      { return MONERO_VERSION_FULL; }));
};

int main()
{
    std::cout << "Initialing module..." << std::endl;

    tools::set_max_concurrency(2);

    // mlog_set_categories("*:TRACE");

    std::cout << "Module initialized" << std::endl;

    return 0;
}
