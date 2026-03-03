#include <iostream>
#include <memory>
#include <algorithm>
#include <type_traits>
#include <utility>
#include "wallet/wallet2.h"
#include "wallet/api/wallet2_api.h"
#include "version.h"
#include "mnemonics/electrum-words.h"
#include <thread>
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

    MoneroWasmWallet(cryptonote::network_type network_type)
        : m_wallet(
              network_type,                                                   // nettype
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
        crypto::secret_key dst;
        auto words_param = epee::wipeable_string(words);
        bool r = crypto::ElectrumWords::words_to_bytes(words_param, dst, language_name);
        if (!r)
        {
            return emscripten::val::null();
        }
        else
        {
            auto v = emscripten::val::global("Uint8Array").new_(32);
            for (size_t i = 0; i < 32; ++i)
            {
                v.set(i, dst.data[i]);
            }
            return v;
        }
    }

    auto get_address()
    {
        return promise([this]()
                       { return m_wallet.get_address_as_str(); });
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
        return promise([this, accountId]()
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
                           return result; });
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

    auto refresh(bool trusted_daemon, uint64_t start_height, bool check_pool = true, bool try_incremental = true, uint64_t max_blocks = std::numeric_limits<uint64_t>::max())
    {
        return promise([this, trusted_daemon, start_height, check_pool, try_incremental, max_blocks]()
                       {
                           auto r = RefreshResult{};
                           m_wallet.refresh(trusted_daemon, start_height, r.blocksFetched, r.receivedMoney, check_pool, try_incremental, max_blocks);
                           return r; });
    }

    void set_on_new_block_callback(emscripten::val callback)
    {
        m_on_new_block_callback = callback;
    }

    struct PaymentDetails
    {
        std::string payment_id;
        std::string type;
        bool is_unlocked;
        uint64_t block_height;
        uint64_t unlock_time;
        uint64_t timestamp;
        uint64_t amount;
        std::string tx_hash;
        uint64_t fee;
        std::string destinationsStr;
        uint32_t index_major;
        uint32_t index_minor;
        std::string note;
    };

    // TODO: Add support for sub-addresses filtering
    auto get_payments(uint64_t min_height, uint64_t max_height)
    {
        return promise([this, min_height, max_height]()
                       { return get_payments_impl(min_height, max_height); });
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

                auto destinationsStr = m_wallet.get_subaddress_as_str({pd.m_subaddr_index.major, pd.m_subaddr_index.minor}) + ":" + std::to_string(pd.m_amount);

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
                    .destinationsStr = destinationsStr,
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

                std::string destinationsStr;
                for (const auto &d : pd.m_dests)
                {
                    if (!destinationsStr.empty())
                    {
                        destinationsStr += ";";
                    };
                    destinationsStr += d.address(m_wallet.nettype(), pd.m_payment_id) + ":" + std::to_string(d.amount);
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
                                  .destinationsStr = destinationsStr,
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

                std::string destinationsStr;
                for (const auto &d : pd.m_dests)
                {
                    if (!destinationsStr.empty())
                    {
                        destinationsStr += ";";
                    };
                    destinationsStr += d.address(m_wallet.nettype(), pd.m_payment_id) + ":" + std::to_string(d.amount);
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
                    .destinationsStr = destinationsStr,
                    .index_major = pd.m_subaddr_account,
                    // TODO: For ourgoing it can be multiple sub-addresses
                    .index_minor = 0xFFFFFFFF,
                    .note = note,
                });
            }
        }
        return result;
    }

    auto get_payments_mempool()
    {
        return promise([this]()
                       { return get_payments_mempool_impl(); });
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
                auto result = emscripten::val::array();
                for (size_t i = 0; i < incoming_transfers.size(); ++i)
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
                    result.set(static_cast<uint32_t>(i), item);
                }
                return result;
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

            auto destinationsStr = m_wallet.get_subaddress_as_str({pd.m_subaddr_index.major, pd.m_subaddr_index.minor}) + ":" + std::to_string(pd.m_amount);

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
                .destinationsStr = destinationsStr,
                .index_major = pd.m_subaddr_index.major,
                .index_minor = pd.m_subaddr_index.minor,
                .note = note,
            });
        }

        return result;
    }

    auto transfer_prepare(emscripten::val dst_addresses_js, emscripten::val amounts_js, uint32_t priority)
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

        return promise([this, dst_addresses = std::move(dst_addresses), amounts = std::move(amounts), priority]()
                       { return transfer_impl(dst_addresses, amounts, priority); });
    }

    emscripten::val get_transfers_info(std::shared_ptr<std::vector<tools::wallet2::pending_tx>> ptx_vector)
    {
        return get_transfers_info_impl(*ptx_vector);
    }

    emscripten::val get_multisig_tx_set_info(std::shared_ptr<tools::wallet2::multisig_tx_set> multisig_tx_set)
    {
        return get_transfers_info_impl(multisig_tx_set->m_ptx);
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
                           return txs; });
    }

    auto sign_multisig_tx(std::shared_ptr<tools::wallet2::multisig_tx_set> multisig_tx_set)
    {
        return promise(
            [this, multisig_tx_set]()
            {
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
                auto result = emscripten::val::array();
                for (size_t i = 0; i < txids.size(); ++i)
                {
                    result.set(static_cast<uint32_t>(i), txids[i]);
                }
                return result;
            });
    }

    auto save_multisig_tx(std::shared_ptr<tools::wallet2::multisig_tx_set> multisig_tx_set)
    {
        return promise(
            [this, multisig_tx_set]()
            { return m_wallet.save_multisig_tx(*multisig_tx_set); },
            [](const std::string &ciphertext) -> emscripten::val
            {
                auto *bytes = reinterpret_cast<const std::uint8_t *>(ciphertext.data());
                return MoneroWasmWallet::copy_bytes_to_uint8_array(bytes, ciphertext.size());
            });
    }

    size_t get_multisig_tx_signers_count(std::shared_ptr<tools::wallet2::multisig_tx_set> multisig_tx_set, bool exclude_self)
    {
        if (exclude_self &&
            multisig_tx_set->m_signers.find(m_wallet.get_multisig_signer_public_key()) != multisig_tx_set->m_signers.end())
        {
            return multisig_tx_set->m_signers.size() - 1;
        }
        else
        {
            return multisig_tx_set->m_signers.size();
        }
    }

    auto transfer_commit_tx_multisig(std::shared_ptr<tools::wallet2::multisig_tx_set> multisig_tx_set)
    {
        return promise([this, multisig_tx_set]()
                       {
                           m_wallet.commit_tx(multisig_tx_set->m_ptx);
                           return true; });
    }

    emscripten::val get_transfers_info_impl(const std::vector<tools::wallet2::pending_tx> &ptx_vector)
    {
        auto result = emscripten::val::array();

        for (size_t tx_index = 0; tx_index < ptx_vector.size(); ++tx_index)
        {
            const auto &ptx = ptx_vector[tx_index];
            auto tx_item = emscripten::val::object();
            tx_item.set("fee", ptx.fee);

            auto destinations = emscripten::val::array();
            for (size_t dst_index = 0; dst_index < ptx.dests.size(); ++dst_index)
            {
                const auto &dst = ptx.dests[dst_index];
                auto dst_item = emscripten::val::object();
                dst_item.set("dstAddress", cryptonote::get_account_address_as_str(m_wallet.nettype(), dst.is_subaddress, dst.addr));
                dst_item.set("dspAmount", dst.amount);
                destinations.set(static_cast<uint32_t>(dst_index), dst_item);
            }
            tx_item.set("destinations", destinations);
            result.set(static_cast<uint32_t>(tx_index), tx_item);
        }
        return result;
    }

    auto transfer_commit_tx(std::shared_ptr<std::vector<tools::wallet2::pending_tx>> ptx_vector)
    {
        return promise([this, ptx_vector]()
                       {
                           m_wallet.commit_tx(*ptx_vector);
                           return true; });
    }

    auto save_multisig_tx_pending_tx(std::shared_ptr<std::vector<tools::wallet2::pending_tx>> ptx_vector)
    {
        return promise(
            [this, ptx_vector]()
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
                return m_wallet.save_multisig_tx(*ptx_vector);
            },
            [](const std::string &ciphertext) -> emscripten::val
            {
                auto *bytes = reinterpret_cast<const std::uint8_t *>(ciphertext.data());
                return MoneroWasmWallet::copy_bytes_to_uint8_array(bytes, ciphertext.size());
            });
    }

    std::shared_ptr<std::vector<tools::wallet2::pending_tx>> transfer_impl(const std::vector<std::string> &dst_addresses, const std::vector<uint64_t> &amounts, uint32_t priority)
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

        const size_t min_ring_size = m_wallet.get_min_ring_size();
        size_t fake_outs_count = min_ring_size - 1;

        std::vector<uint8_t> extra;
        std::set<uint32_t> subaddr_indices;

        auto ptx_vector = m_wallet.create_transactions_2(dsts, fake_outs_count,
                                                         priority,
                                                         extra,
                                                         0, subaddr_indices);
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
            [p, result, error, pack_to_js = std::forward<PackFn>(pack_to_js)]() mutable
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

    tools::wallet2 m_wallet;

    pthread_t walletThread;
    emscripten::ProxyingQueue walletQueue;

    // Assuming that constructor is called in the main thread
    pthread_t mainThread = pthread_self();
    emscripten::ProxyingQueue mainThreadQueue;

    emscripten::val m_on_new_block_callback = emscripten::val::null();
};

EMSCRIPTEN_BINDINGS(monero_wasm_wallet)
{
    emscripten::enum_<cryptonote::network_type>("NetworkType")
        .value("MAINNET", cryptonote::network_type::MAINNET)
        .value("TESTNET", cryptonote::network_type::TESTNET)
        .value("STAGENET", cryptonote::network_type::STAGENET);

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
        .function("balance", &MoneroWasmWallet::balance)
        .function("unlocked_balance", &MoneroWasmWallet::unlocked_balance)
        .function("set_refresh_from_block_height", &MoneroWasmWallet::set_refresh_from_block_height)
        .function("set_explicit_refresh_from_block_height", &MoneroWasmWallet::set_explicit_refresh_from_block_height)
        .function("get_blockchain_current_height", &MoneroWasmWallet::get_blockchain_current_height)
        .function("get_blockchain_height_by_date", &MoneroWasmWallet::get_blockchain_height_by_date)
        .function("words_to_bytes", &MoneroWasmWallet::words_to_bytes)
        .function("transfer_prepare", &MoneroWasmWallet::transfer_prepare)
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
        .function("prepare_multisig", &MoneroWasmWallet::prepare_multisig)
        .function("make_multisig", &MoneroWasmWallet::make_multisig)
        .function("exchange_multisig_keys", &MoneroWasmWallet::exchange_multisig_keys)
        .function("export_multisig", &MoneroWasmWallet::export_multisig)
        .function("import_multisig", &MoneroWasmWallet::import_multisig)
        .function("export_key_images", &MoneroWasmWallet::export_key_images)
        .function("import_key_images", &MoneroWasmWallet::import_key_images)
        .function("verify_password", &MoneroWasmWallet::verify_password)
        .function("rescan_blockchain", &MoneroWasmWallet::rescan_blockchain)
        .constructor<cryptonote::network_type>();

    emscripten::class_<std::vector<tools::wallet2::pending_tx>>("VectorOfPendingTx")
        .smart_ptr<std::shared_ptr<std::vector<tools::wallet2::pending_tx>>>("VectorOfPendingTx");
    emscripten::class_<tools::wallet2::multisig_tx_set>("MultisigTxSetHandle")
        .smart_ptr<std::shared_ptr<tools::wallet2::multisig_tx_set>>("MultisigTxSetHandle");

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
    emscripten::register_vector<struct MoneroWasmWallet::PaymentDetails>("PaymentDetailsVector");
    emscripten::register_vector<struct MoneroWasmWallet::WalletAddress>("WalletAddressVector");
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
        .field("destinationsStr", &MoneroWasmWallet::PaymentDetails::destinationsStr)
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
