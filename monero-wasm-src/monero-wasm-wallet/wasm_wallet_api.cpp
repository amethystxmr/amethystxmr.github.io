#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <limits>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <type_traits>
#include <utility>

#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/val.h>

#include "common/util.h"
#include "memwipe.h"
#include "mnemonics/electrum-words.h"
#include "multisig/multisig.h"
#include "multisig/multisig_account.h"
#include "multisig/multisig_kex_msg.h"
#include "multisig/multisig_tx_builder_ringct.h"
#include "version.h"
#include "wallet/api/wallet2_api.h"
#include "wallet/wallet2.h"

#include "emval_helpers.hpp"
#include "http.hpp"

using WalletNetworkTypeBacking = std::underlying_type_t<cryptonote::network_type>;
using WalletPriorityBacking = std::underlying_type_t<Monero::PendingTransaction::Priority>;
using WalletTxHandle = std::uint32_t;

static_assert(std::is_same_v<WalletNetworkTypeBacking, std::uint8_t>,
              "cryptonote::network_type backing type must be uint8_t");
static_assert(std::is_same_v<WalletPriorityBacking, unsigned int>,
              "Monero::PendingTransaction::Priority backing type must be unsigned int");

namespace
{
// Wasm is built without `-sUSE_PTHREADS`; cap Boost concurrency before embind.
// Also call `set_max_concurrency(1)` from `main()` so it runs after all static
// initializers (see `common/util.cpp` max_concurrency init order across TUs).
struct WasmWalletConcurrencyInit
{
    WasmWalletConcurrencyInit()
    {
        tools::set_max_concurrency(1);
    }
} wasm_wallet_concurrency_init;
} // namespace

class MoneroWasmWallet : public tools::i_wallet2_callback
{
public:
    // Full wallet callbacks
    void on_new_block(uint64_t height, const cryptonote::block &block) override
    {
        const auto timestamp = block.timestamp;
        if (m_on_new_block_callback.isNull() || m_on_new_block_callback.isUndefined())
        {
            return;
        }
        m_on_new_block_callback(height, timestamp);
    }
    // Reference: other `i_wallet2_callback` virtuals available to override (defined in
    // `wallet/wallet2.h`). Not implemented here; kept as a checklist of forwarding
    // hooks we may want to expose to JS later.
    //
    //   on_reorg, on_money_received, on_unconfirmed_money_received,
    //   on_money_spent, on_skip_transaction, on_get_password,
    //   on_device_button_request, on_device_button_pressed,
    //   on_device_pin_request, on_device_passphrase_request,
    //   on_device_progress, on_pool_tx_removed

    MoneroWasmWallet(WalletNetworkTypeBacking network_type_value)
        : m_wallet(
              static_cast<cryptonote::network_type>(network_type_value),      // nettype
              1,                                                              // kdf_rounds
              true,                                                           // unattended
              std::make_unique<js_client_factory>())                          // http_client_factory
    {
        std::cout << "Wallet created" << std::endl;
        m_wallet.callback(this);
    }
    ~MoneroWasmWallet()
    {
        m_tx_handles.clear();
        m_pending_tx_handles.clear();
        m_multisig_tx_handles.clear();
        m_wallet.stop();
        std::cout << "Wallet destroyed" << std::endl;
    }

    auto init()
    {
        // The daemon address is required by `wallet2::init` but unused: our
        // `js_client_factory` routes all HTTP through the JS side, so the URL
        // here is just a placeholder that satisfies the API.
        return m_wallet.init("127.1.2.3");
    }

    auto get_daemon_blockchain_height()
    {
        auto err = std::string{};
        auto blockchain_height = m_wallet.get_daemon_blockchain_height(err);
        if (!err.empty())
        {
            throw std::runtime_error(err);
        }
        return blockchain_height;
    }

    emscripten::val generate(
        std::string fileName,
        std::string password,
        emscripten::val secretArrayBuf,
        bool recover,
        bool two_random)
    {
        validate_js_uint8_array_len(secretArrayBuf, 32, "secret32");
        crypto::secret_key secretKey;
        copy_js_uint8_array_to(secretArrayBuf, reinterpret_cast<std::uint8_t *>(secretKey.data), 32);

        const auto r = m_wallet.generate(
            fileName,
            epee::wipeable_string(password),
            secretKey,
            recover,
            two_random);

        return copy_bytes_to_uint8_array(reinterpret_cast<const std::uint8_t *>(r.data), sizeof(r.data));
    }

    void generate_multisig_restore(
        const std::string &fileName,
        const std::string &password,
        const std::string &multisig_data_hex,
        bool create_address_file)
    {
        const epee::wipeable_string password_w{password};
        const epee::wipeable_string multisig_seed_hex{multisig_data_hex};

        const boost::optional<epee::wipeable_string> parsed = multisig_seed_hex.parse_hexstr();
        if (!parsed)
        {
            throw std::runtime_error("Multisig seed failed verification");
        }
        m_wallet.generate(
            fileName,
            password_w,
            *parsed,
            create_address_file);
    }

    void generate_from_keys(
        const std::string &fileName,
        const std::string &password,
        const std::string &address,
        emscripten::val secret_view_key_buf,
        emscripten::val secret_spend_key_buf,
        bool create_address_file)
    {
        validate_js_uint8_array_len(secret_view_key_buf, 32, "secretViewKey");
        validate_js_uint8_array_len(secret_spend_key_buf, 32, "secretSpendKey");
        crypto::secret_key viewkey;
        crypto::secret_key spendkey;
        copy_js_uint8_array_to(secret_view_key_buf, reinterpret_cast<std::uint8_t *>(viewkey.data), 32);
        copy_js_uint8_array_to(secret_spend_key_buf, reinterpret_cast<std::uint8_t *>(spendkey.data), 32);

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
            spendkey,
            viewkey,
            create_address_file);
    }

    void generate_view_only_from_keys(
        const std::string &fileName,
        const std::string &password,
        const std::string &address,
        emscripten::val secret_view_key_buf,
        bool create_address_file)
    {
        validate_js_uint8_array_len(secret_view_key_buf, 32, "secretViewKey");
        crypto::secret_key viewkey;
        copy_js_uint8_array_to(secret_view_key_buf, reinterpret_cast<std::uint8_t *>(viewkey.data), 32);

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
            viewkey,
            create_address_file);
    }

    void store()
    {
        m_wallet.store();
    }

    void set_attribute(const std::string &key, const std::string &value)
    {
        m_wallet.set_attribute(key, value);
    }

    auto get_attribute(const std::string &key)
    {
        std::string r;
        m_wallet.get_attribute(key, r);
        return r;
    }

    void load(
        const std::string &fileName,
        const std::string &password)
    {
        m_wallet.load(fileName, epee::wipeable_string(password));
    }

    emscripten::val words_to_bytes(const std::string &words,
                                   const std::string &language_name)
    {
        crypto::secret_key dst{};
        epee::wipeable_string words_param(words);
        // `words_to_bytes` takes `language_name` by non-const ref (it can return
        // the detected language when an empty hint is passed). We don't read
        // the result back, so feed it a local copy.
        std::string language_name_inout = language_name;
        const bool r = crypto::ElectrumWords::words_to_bytes(words_param, dst, language_name_inout);
        if (!r)
        {
            return emscripten::val::null();
        }
        std::array<std::uint8_t, 32> bytes{};
        std::copy_n(
            reinterpret_cast<const std::uint8_t *>(dst.data),
            bytes.size(),
            bytes.begin());
        return copy_bytes_to_uint8_array(bytes.data(), bytes.size());
    }

    auto get_address()
    {
        return m_wallet.get_address_as_str();
    }

    auto get_network_type()
    {
        return static_cast<WalletNetworkTypeBacking>(m_wallet.nettype());
    }

    void allow_mismatched_daemon_version(bool allow_mismatch)
    {
        m_wallet.allow_mismatched_daemon_version(allow_mismatch);
    }

    auto watch_only()
    {
        return m_wallet.watch_only();
    }

    auto is_deterministic()
    {
        return m_wallet.is_deterministic();
    }

    emscripten::val get_keys(uint32_t account_idx)
    {
        if (account_idx >= m_wallet.get_num_subaddress_accounts())
        {
            throw std::runtime_error("Account index out of range");
        }

        const auto &keys = m_wallet.get_account().get_keys();
        const bool has_spend_private = !m_wallet.watch_only() && keys.m_spend_secret_key != crypto::null_skey;

        auto result = emscripten::val::object();
        result.set("address", m_wallet.get_subaddress_as_str({account_idx, 0}));

        auto view_key = emscripten::val::object();
        auto *view_private_bytes = reinterpret_cast<const std::uint8_t *>(keys.m_view_secret_key.data);
        auto *view_public_bytes = reinterpret_cast<const std::uint8_t *>(keys.m_account_address.m_view_public_key.data);
        view_key.set("private", copy_bytes_to_uint8_array(view_private_bytes, 32));
        view_key.set("public", copy_bytes_to_uint8_array(view_public_bytes, 32));
        result.set("viewKey", view_key);

        auto spend_key = emscripten::val::object();
        if (has_spend_private)
        {
            auto *spend_private_bytes = reinterpret_cast<const std::uint8_t *>(keys.m_spend_secret_key.data);
            spend_key.set("private", copy_bytes_to_uint8_array(spend_private_bytes, 32));
        }
        else
        {
            spend_key.set("private", emscripten::val::null());
        }
        auto *spend_public_bytes = reinterpret_cast<const std::uint8_t *>(keys.m_account_address.m_spend_public_key.data);
        spend_key.set("public", copy_bytes_to_uint8_array(spend_public_bytes, 32));
        result.set("spendKey", spend_key);

        return result;
    }

    auto get_num_subaddresses(uint32_t index_major)
    {
        return m_wallet.get_num_subaddresses(index_major);
    }
    auto get_subaddress_as_str(uint32_t index_major, uint32_t index_minor)
    {
        return m_wallet.get_subaddress_as_str({index_major, index_minor});
    }
    auto get_subaddress_label(uint32_t index_major, uint32_t index_minor)
    {
        return m_wallet.get_subaddress_label({index_major, index_minor});
    }

    struct WalletAddress
    {
        std::string address;
        std::string label;
        uint32_t indexMinor;
    };

    emscripten::val get_wallet_addresses(uint32_t accountId)
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
        return vector_to_js_array(result, [](const WalletAddress &wa)
                                  { return emscripten::val(wa); });
    }
    void add_subaddress(uint32_t index_major, const std::string &label)
    {
        m_wallet.add_subaddress(index_major, label);
    }

    auto is_synced()
    {
        return m_wallet.is_synced();
    }

    // Note: `wallet2::get_seed` returns the seed in a `wipeable_string` so that
    // the buffer is zeroed on destruction. Embind cannot bind `wipeable_string`
    // to JS, so we copy into a regular `std::string`. The seed therefore lives
    // briefly in a non-wiped heap buffer here and again on the JS side; this is
    // an accepted trade-off for the WASM transport.
    std::string get_seed(const std::string &seed_language, const std::string &seedPassphrase)
    {
        m_wallet.set_seed_language(seed_language);
        epee::wipeable_string r;
        if (!m_wallet.get_seed(r, seedPassphrase))
        {
            throw std::runtime_error("Failed to get seed");
        }
        return std::string(r.data(), r.size());
    }

    std::string get_multisig_seed(const std::string &seedPassphrase)
    {
        epee::wipeable_string r;
        if (!m_wallet.get_multisig_seed(r, seedPassphrase))
        {
            throw std::runtime_error("Failed to get multisig seed");
        }
        return std::string(r.data(), r.size());
    }

    void rewrite(const std::string &wallet_file, const std::string &password_str)
    {
        const epee::wipeable_string password{password_str};
        m_wallet.rewrite(wallet_file, password);
    }

    /** `double`: Embind/asyncify rewind mishandles mixed i64/bigint returns on some WASM runs;
     *  blocks fetched per refresh fits safely in IEEE double integer range. */
    struct RefreshResult
    {
        double blocksFetched;
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

    static uint64_t js_double_refresh_u64(double v, const char *what)
    {
        if (!(v >= 0) || std::isnan(v) || std::isinf(v))
        {
            throw std::runtime_error(std::string("invalid ") + what);
        }
        constexpr double hi = static_cast<double>(std::numeric_limits<uint64_t>::max());
        if (v >= hi)
        {
            return std::numeric_limits<uint64_t>::max();
        }
        return static_cast<uint64_t>(v);
    }

    /** `null`/`undefined` -> nullopt, number -> validated u64. */
    static std::optional<uint64_t> js_val_to_optional_u64(const emscripten::val &v, const char *what)
    {
        if (v.isNull() || v.isUndefined())
        {
            return std::nullopt;
        }
        return js_double_refresh_u64(v.as<double>(), what);
    }

    /** `start_height_js` as double: Asyncify rewind + WASM_BIGINT mishandles
     *  bigint call args, so heights are passed as `double`. `max_blocks_js`
     *  accepts a number for an upper bound or `null`/`undefined` for "no
     *  limit".
     *
     *  Exceptions from `m_wallet.refresh` often propagate to JS as a **synchronous**
     *  throw (numeric pointer). The wallet worker must map those with
     *  `wasmThrownValueToError` — see `walletApi.worker.ts` `ensureSequential`
     *  (`try` around `apply`, not only `Promise` `.catch`). */
    RefreshResult refresh(bool trusted_daemon, double start_height_js, bool check_pool, bool try_incremental, emscripten::val max_blocks_js)
    {
        const uint64_t start_height = js_double_refresh_u64(start_height_js, "refresh start_height");
        const std::optional<uint64_t> max_blocks_opt = js_val_to_optional_u64(max_blocks_js, "refresh max_blocks");
        const uint64_t max_blocks = max_blocks_opt.value_or(std::numeric_limits<uint64_t>::max());

        uint64_t fetched = 0;
        bool receivedMoney = false;
        m_wallet.refresh(trusted_daemon, start_height, fetched, receivedMoney, check_pool, try_incremental, max_blocks);
        return RefreshResult{.blocksFetched = static_cast<double>(fetched), .receivedMoney = receivedMoney};
    }

    void set_on_new_block_callback(emscripten::val callback)
    {
        m_on_new_block_callback = callback;
    }

    // Sentinel for `confirmed_transfer_details::m_change` when the change is
    // unknown (matches the upstream `wallet2.cpp` convention).
    static constexpr uint64_t UNKNOWN_CHANGE = std::numeric_limits<uint64_t>::max();

    // Sentinel `index_minor` reported when an outgoing transfer spans multiple
    // sub-addresses, so a single index cannot be returned.
    static constexpr uint32_t MULTIPLE_SUBADDRESSES = std::numeric_limits<uint32_t>::max();

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
    emscripten::val get_payments(uint64_t min_height, uint64_t max_height)
    {
        std::vector<PaymentDetails> result;
        { // Incoming payments
            std::list<std::pair<crypto::hash, tools::wallet2::payment_details>> payments;

            m_wallet.get_payments(payments, min_height, max_height);

            for (const auto &[payment_id, pd] : payments)
            {
                const std::string type = pd.m_coinbase ? "block" : "in";

                const bool unlocked = m_wallet.is_transfer_unlocked(pd.m_unlock_time, pd.m_block_height);

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
                    .fee = 0,
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
            for (const auto &[tx_hash, pd] : payments)
            {
                const std::string type = "out";

                const bool unlocked = m_wallet.is_transfer_unlocked(pd.m_unlock_time, pd.m_block_height);
                uint64_t change = pd.m_change == UNKNOWN_CHANGE ? 0 : pd.m_change;
                uint64_t fee = pd.m_amount_in - pd.m_amount_out;

                std::vector<PaymentDetails::Destination> destinations;
                destinations.reserve(pd.m_dests.size());
                for (const auto &d : pd.m_dests)
                {
                    destinations.push_back(PaymentDetails::Destination{
                        d.address(m_wallet.nettype(), pd.m_payment_id),
                        d.amount});
                }

                std::string note = m_wallet.get_tx_note(tx_hash);

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
                                  // TODO: For outgoing it can be multiple sub-addresses
                                  .index_minor = MULTIPLE_SUBADDRESSES,
                                  .note = note});
            }
        }
        { // Unconfirmed (pending/failed) outgoing payments
            std::list<std::pair<crypto::hash, tools::wallet2::unconfirmed_transfer_details>> upayments;
            m_wallet.get_unconfirmed_payments_out(upayments);
            for (const auto &[tx_hash, pd] : upayments)
            {
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

                const std::string payment_id = epee::string_tools::pod_to_hex(pd.m_payment_id);
                const std::string note = m_wallet.get_tx_note(tx_hash);
                const bool is_failed = pd.m_state == tools::wallet2::unconfirmed_transfer_details::failed;
                const std::string type = is_failed ? "failed" : "pending";

                result.push_back({
                    .payment_id = payment_id,
                    .type = type,
                    .is_unlocked = false,
                    .block_height = 0,
                    .unlock_time = 0,
                    .timestamp = pd.m_timestamp,
                    .amount = amount - pd.m_change - fee,
                    .tx_hash = epee::string_tools::pod_to_hex(tx_hash),
                    .fee = fee,
                    .destinations = std::move(destinations),
                    .index_major = pd.m_subaddr_account,
                    // TODO: For outgoing it can be multiple sub-addresses
                    .index_minor = MULTIPLE_SUBADDRESSES,
                    .note = note,
                });
            }
        }
        sort_payment_details(result);
        return vector_to_js_array(result, &payment_details_to_val);
    }

    emscripten::val get_transfers()
    {
        tools::wallet2::transfer_container incoming_transfers;
        m_wallet.get_transfers(incoming_transfers);
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
    }

    /** Updates pool state on the daemon then returns mempool payments. */
    emscripten::val get_payments_mempool()
    {
        std::vector<std::tuple<cryptonote::transaction, crypto::hash, bool>> process_txs;
        m_wallet.update_pool_state(process_txs);
        if (!process_txs.empty())
            m_wallet.process_pool_state(process_txs);

        std::list<std::pair<crypto::hash, tools::wallet2::pool_payment_details>> payments;
        m_wallet.get_unconfirmed_payments(payments);

        std::vector<PaymentDetails> result;
        for (const auto &[payment_hash, ppd] : payments)
        {
            const tools::wallet2::payment_details &pd = ppd.m_pd;
            const std::string payment_id = epee::string_tools::pod_to_hex(payment_hash);
            const std::string note = m_wallet.get_tx_note(pd.m_tx_hash);

            std::vector<PaymentDetails::Destination> destinations{
                PaymentDetails::Destination{
                    m_wallet.get_subaddress_as_str({pd.m_subaddr_index.major, pd.m_subaddr_index.minor}),
                    pd.m_amount}};

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
        return vector_to_js_array(result, &payment_details_to_val);
    }

    auto transfer_prepare(
        emscripten::val dst_addresses_js,
        emscripten::val amounts_js,
        WalletPriorityBacking priority,
        emscripten::val subtract_fee_from_index_js)
    {
        auto dst_addresses = parse_js_string_array(dst_addresses_js);
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

        std::vector<cryptonote::tx_destination_entry> dsts;
        dsts.reserve(dst_addresses.size());
        std::vector<uint8_t> extra;
        bool payment_id_seen = false;
        for (size_t i = 0; i < dst_addresses.size(); ++i)
        {
            cryptonote::address_parse_info info;
            if (!cryptonote::get_account_address_from_str(info, m_wallet.nettype(), dst_addresses[i]))
            {
                throw std::runtime_error("Invalid destination address at index " + std::to_string(i));
            }

            cryptonote::tx_destination_entry de;
            de.original = dst_addresses[i];
            de.addr = info.address;
            de.is_subaddress = info.is_subaddress;
            de.is_integrated = info.has_payment_id;
            de.amount = amounts[i];
            dsts.push_back(de);

            if (info.has_payment_id)
            {
                if (payment_id_seen)
                {
                    throw std::runtime_error("A single payment id is allowed per transaction");
                }
                if (dst_addresses.size() > 1)
                {
                    throw std::runtime_error(
                        "Integrated addresses cannot be used with multiple recipients in one transaction");
                }
                add_integrated_payment_id_to_extra(extra, info.payment_id);
                payment_id_seen = true;
            }
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

        const size_t fake_outs_count = m_wallet.get_min_ring_size() - 1;
        std::set<uint32_t> subaddr_indices;

        auto ptx_vector = m_wallet.create_transactions_2(
            dsts, fake_outs_count, static_cast<uint32_t>(priority),
            extra, 0, subaddr_indices, subtract_fee_from_outputs);
        if (ptx_vector.empty())
        {
            throw std::runtime_error("No outputs found, or daemon is not ready");
        }

        return register_pending_tx_handle(
            std::make_shared<std::vector<tools::wallet2::pending_tx>>(std::move(ptx_vector)));
    }

    auto transfer_prepare_sweep_all(
        const std::string &dst_address,
        WalletPriorityBacking priority)
    {
        if (dst_address.empty())
        {
            throw std::runtime_error("Destination address is empty");
        }

        cryptonote::address_parse_info info;
        if (!cryptonote::get_account_address_from_str(info, m_wallet.nettype(), dst_address))
        {
            throw std::runtime_error("Invalid destination address");
        }

        const size_t fake_outs_count = m_wallet.get_min_ring_size() - 1;
        std::vector<uint8_t> extra;
        if (info.has_payment_id)
        {
            add_integrated_payment_id_to_extra(extra, info.payment_id);
        }
        std::set<uint32_t> subaddr_indices;
        for (uint32_t i = 0; i < m_wallet.get_num_subaddresses(0); ++i)
        {
            subaddr_indices.insert(i);
        }

        auto ptx_vector = m_wallet.create_transactions_all(
            0, info.address, info.is_subaddress, 1,
            fake_outs_count, static_cast<uint32_t>(priority),
            extra, 0, subaddr_indices);
        if (ptx_vector.empty())
        {
            throw std::runtime_error("No outputs found, or daemon is not ready");
        }

        // create_transactions_all does not carry integrated-address metadata on
        // destinations; restore it so confirmation/history show the address the
        // user entered (including the embedded payment id).
        if (info.has_payment_id)
        {
            for (auto &ptx : ptx_vector)
            {
                for (auto &dst : ptx.dests)
                {
                    dst.original = dst_address;
                    dst.is_integrated = true;
                }
            }
        }

        return register_pending_tx_handle(
            std::make_shared<std::vector<tools::wallet2::pending_tx>>(std::move(ptx_vector)));
    }

    emscripten::val get_transfers_info(WalletTxHandle handle)
    {
        return pending_tx_vector_to_js_array(*require_pending_tx_handle(handle));
    }

    emscripten::val get_multisig_tx_set_info(WalletTxHandle handle)
    {
        return pending_tx_vector_to_js_array(require_multisig_tx_handle(handle)->m_ptx);
    }

    auto load_multisig_tx(emscripten::val data_js, bool do_accept)
    {
        auto data = parse_js_uint8_array(data_js);
        cryptonote::blobdata blob(reinterpret_cast<const char *>(data.data()), data.size());

        // `wallet2::load_multisig_tx` populates `*txs` during parsing, before
        // the accept callback runs. If the callback returns `false` wallet2
        // skips its post-load bookkeeping and reports failure, but `*txs`
        // already holds the parsed transactions, which is what we want when
        // the caller only intends to inspect them. We use the callback firing
        // as the signal that parsing succeeded; otherwise we throw.
        auto txs = std::make_shared<tools::wallet2::multisig_tx_set>();
        bool parsed = false;
        m_wallet.load_multisig_tx(blob, *txs,
            [do_accept, &parsed](const tools::wallet2::multisig_tx_set &)
            {
                parsed = true;
                return do_accept;
            });
        if (!parsed)
        {
            throw std::runtime_error("Failed to parse multisig transaction");
        }
        return register_multisig_tx_handle(txs);
    }

    emscripten::val sign_multisig_tx(WalletTxHandle handle)
    {
        const auto &multisig_tx_set = require_multisig_tx_handle(handle);
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
        return vector_to_js_array(txids, [](const std::string &s)
                                  { return emscripten::val(s); });
    }

    emscripten::val save_multisig_tx(WalletTxHandle handle)
    {
        const auto ciphertext = m_wallet.save_multisig_tx(*require_multisig_tx_handle(handle));
        auto *bytes = reinterpret_cast<const std::uint8_t *>(ciphertext.data());
        return copy_bytes_to_uint8_array(bytes, ciphertext.size());
    }

    auto get_multisig_tx_signers_count(WalletTxHandle handle, bool exclude_self)
    {
        const auto &multisig_tx_set = require_multisig_tx_handle(handle);
        if (exclude_self &&
            multisig_tx_set->m_signers.find(m_wallet.get_multisig_signer_public_key()) != multisig_tx_set->m_signers.end())
        {
            return multisig_tx_set->m_signers.size() - 1;
        }
        return multisig_tx_set->m_signers.size();
    }

    void transfer_commit_tx_multisig(WalletTxHandle handle)
    {
        m_wallet.commit_tx(require_multisig_tx_handle(handle)->m_ptx);
    }

    void transfer_commit_tx(WalletTxHandle handle)
    {
        m_wallet.commit_tx(*require_pending_tx_handle(handle));
    }

    emscripten::val save_multisig_tx_pending_tx(WalletTxHandle handle)
    {
        require_multisig_active_and_ready();
        const auto ciphertext = m_wallet.save_multisig_tx(*require_pending_tx_handle(handle));
        auto *bytes = reinterpret_cast<const std::uint8_t *>(ciphertext.data());
        return copy_bytes_to_uint8_array(bytes, ciphertext.size());
    }

    void destroy_tx_handle(WalletTxHandle handle)
    {
        m_tx_handles.erase(handle);
        m_pending_tx_handles.erase(handle);
        m_multisig_tx_handles.erase(handle);
    }

private:
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

    const std::shared_ptr<std::vector<tools::wallet2::pending_tx>> &require_pending_tx_handle(WalletTxHandle handle) const
    {
        const auto it = m_pending_tx_handles.find(handle);
        if (it == m_pending_tx_handles.end())
        {
            throw std::runtime_error("Pending transaction handle is not available");
        }
        return it->second;
    }

    const std::shared_ptr<tools::wallet2::multisig_tx_set> &require_multisig_tx_handle(WalletTxHandle handle) const
    {
        const auto it = m_multisig_tx_handles.find(handle);
        if (it == m_multisig_tx_handles.end())
        {
            throw std::runtime_error("Multisig transaction handle is not available");
        }
        return it->second;
    }

    emscripten::val pending_tx_vector_to_js_array(const std::vector<tools::wallet2::pending_tx> &ptxs) const
    {
        const auto nettype = m_wallet.nettype();
        return indexed_to_js_array(ptxs.size(), [&](std::size_t i) -> emscripten::val
        {
            const auto &ptx = ptxs[i];

            crypto::hash payment_id = crypto::null_hash;
            {
                std::vector<cryptonote::tx_extra_field> tx_extra_fields;
                if (cryptonote::parse_tx_extra(ptx.construction_data.extra, tx_extra_fields))
                {
                    cryptonote::tx_extra_nonce extra_nonce;
                    crypto::hash8 payment_id8 = crypto::null_hash8;
                    if (cryptonote::find_tx_extra_field_by_type(tx_extra_fields, extra_nonce) &&
                        cryptonote::get_encrypted_payment_id_from_tx_extra_nonce(extra_nonce.nonce, payment_id8))
                    {
                        memcpy(payment_id.data, payment_id8.data, sizeof(payment_id8));
                    }
                }
            }

            auto tx_item = emscripten::val::object();
            tx_item.set("fee", ptx.fee);
            tx_item.set("changeAmount", ptx.change_dts.amount);
            tx_item.set("destinations", indexed_to_js_array(ptx.dests.size(), [&](std::size_t j) -> emscripten::val
            {
                const auto &dst = ptx.dests[j];
                auto dst_item = emscripten::val::object();
                dst_item.set("dstAddress", dst.address(nettype, payment_id));
                dst_item.set("dspAmount", dst.amount);
                return dst_item;
            }));
            return tx_item;
        });
    }

    static void add_integrated_payment_id_to_extra(
        std::vector<uint8_t> &extra,
        const crypto::hash8 &payment_id)
    {
        cryptonote::blobdata extra_nonce;
        cryptonote::set_encrypted_payment_id_to_tx_extra_nonce(extra_nonce, payment_id);
        if (!cryptonote::add_extra_nonce_to_tx_extra(extra, extra_nonce))
        {
            throw std::runtime_error("Failed to set integrated payment id");
        }
    }

public:
    auto get_wallet_file()
    {
        return m_wallet.get_wallet_file();
    }

    auto get_tx_proof(const std::string &txid_str, const std::string &dstaddress, const std::string &note)
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

        return m_wallet.get_tx_proof(txid, info.address, info.is_subaddress, note);
    }

    std::string get_tx_key(const std::string &txid_str)
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
        return keys;
    }

    emscripten::val get_tx_keys_for_address(const std::string &txid_str, const std::string &dstaddress)
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

        auto result = emscripten::val::array();
        for (size_t i = 0; i < matching_keys.size(); ++i)
        {
            result.set(static_cast<uint32_t>(i), matching_keys[i]);
        }
        return result;
    }

    auto balance(uint32_t index_major, bool strict)
    {
        return m_wallet.balance(index_major, strict);
    }

    void set_refresh_from_block_height(uint64_t height)
    {
        m_wallet.set_refresh_from_block_height(height);
    }

    void set_explicit_refresh_from_block_height(bool value)
    {
        m_wallet.explicit_refresh_from_block_height(value);
    }

    auto get_blockchain_current_height()
    {
        return m_wallet.get_blockchain_current_height();
    }

    struct UnlockedBalanceResult
    {
        uint64_t balance;
        uint64_t blocks_to_unlock;
        uint64_t time_to_unlock;
    };

    auto unlocked_balance(uint32_t index_major, bool strict)
    {
        auto r = UnlockedBalanceResult{};
        r.balance = m_wallet.unlocked_balance(index_major, strict, &r.blocks_to_unlock, &r.time_to_unlock);
        return r;
    }

    auto get_blockchain_height_by_date(uint16_t year, uint8_t month, uint8_t day)
    {
        return m_wallet.get_blockchain_height_by_date(year, month, day);
    }

    auto get_multisig_status()
    {
        return get_multisig_status_compat();
    }

    auto has_multisig_partial_key_images()
    {
        return m_wallet.has_multisig_partial_key_images();
    }

    auto has_unknown_key_images()
    {
        return m_wallet.has_unknown_key_images();
    }

    auto verify_password(const std::string &password_str)
    {
        epee::wipeable_string password(password_str);
        return m_wallet.verify_password(password);
    }

    auto make_multisig(const std::string &password_str,
                       emscripten::val initial_kex_msgs_js,
                       std::uint32_t threshold)
    {
        auto password = verify_password_or_throw(password_str);
        auto initial_kex_msgs = parse_js_string_array(initial_kex_msgs_js);

        if (get_multisig_status_compat().multisig_is_active)
        {
            throw std::runtime_error("Wallet is already multisig");
        };
        if (m_wallet.get_num_transfer_details())
        {
            throw std::runtime_error("Wallet must be empty to create multisig");
        };
        return m_wallet.make_multisig(password, initial_kex_msgs, threshold);
    }

    auto exchange_multisig_keys(const std::string &password_str, emscripten::val kex_msgs_js)
    {
        auto password = verify_password_or_throw(password_str);
        auto kex_msgs = parse_js_string_array(kex_msgs_js);

        if (!get_multisig_status_compat().multisig_is_active)
        {
            throw std::runtime_error("Wallet is not multisig");
        };
        return m_wallet.exchange_multisig_keys(password, kex_msgs);
    }

    auto prepare_multisig()
    {
        if (m_wallet.get_num_transfer_details() > 0)
        {
            throw std::runtime_error("Wallet must be empty to prepare multisig");
        }
        if (get_multisig_status_compat().multisig_is_active)
        {
            throw std::runtime_error("Wallet is already multisig");
        }
        return m_wallet.get_multisig_first_kex_msg();
    }

    void enable_multisig(bool enable)
    {
        m_wallet.enable_multisig(enable);
    }

    emscripten::val export_multisig()
    {
        require_multisig_active_and_ready();
        const auto ciphertext = m_wallet.export_multisig();
        auto *bytes = reinterpret_cast<const std::uint8_t *>(ciphertext.data());
        return copy_bytes_to_uint8_array(bytes, ciphertext.size());
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

        const auto status = require_multisig_active_and_ready();
        if (info.size() + 1 < status.threshold)
        {
            throw std::runtime_error("Not enough multisig info provided");
        }
        return m_wallet.import_multisig(info);
    }

    void export_key_images(const std::string &filename, bool all)
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
    }

    auto import_key_images(const std::string &filename, bool import_when_untrusted_daemon)
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
    }

    void rescan_blockchain(bool hard, bool keep_key_images)
    {
        m_wallet.rescan_blockchain(hard, false, keep_key_images);
    }

private:
    MultisigStatus get_multisig_status_compat() const
    {
        bool ready = false;
        uint32_t threshold = 0;
        uint32_t total = 0;
        const bool multisig = m_wallet.multisig(&ready, &threshold, &total);
        uint32_t multisig_rounds_passed = 0;
        if (multisig)
        {
            if (ready)
            {
                multisig_rounds_passed = multisig::multisig_setup_rounds_required(total, threshold);
            }
            else
            {
                const auto state = m_wallet.get_multisig_wallet_state();
                multisig_rounds_passed = state.multisig_rounds_passed;
                ready = state.multisig_is_ready;
            }
        }
        return MultisigStatus{
            multisig,
            multisig_rounds_passed > 0,
            ready,
            multisig_rounds_passed,
            threshold,
            total,
        };
    }

    epee::wipeable_string verify_password_or_throw(const std::string &password_str)
    {
        epee::wipeable_string password(password_str);
        if (!m_wallet.verify_password(password))
        {
            throw std::runtime_error("invalid password");
        }
        return password;
    }

    MultisigStatus require_multisig_active_and_ready() const
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
        return status;
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
        o.set("destinations", vector_to_js_array_val(p.destinations));
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

    static std::vector<std::string> parse_js_string_array(const emscripten::val &js_array)
    {
        return parse_js_array<std::string>(
            js_array,
            [](const emscripten::val &item, size_t index) -> std::string
            {
                if (!item.isString())
                {
                    throw std::runtime_error("Expected string at index " + std::to_string(index));
                }
                return item.as<std::string>();
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

    tools::wallet2 m_wallet;
    WalletTxHandle m_next_tx_handle = 1;
    std::set<WalletTxHandle> m_tx_handles;
    std::map<WalletTxHandle, std::shared_ptr<std::vector<tools::wallet2::pending_tx>>> m_pending_tx_handles;
    std::map<WalletTxHandle, std::shared_ptr<tools::wallet2::multisig_tx_set>> m_multisig_tx_handles;

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
        .function("destroy_tx_handle", &MoneroWasmWallet::destroy_tx_handle)
        .constructor<WalletNetworkTypeBacking>();

    emscripten::value_object<MoneroWasmWallet::MultisigStatus>("MultisigAccountStatus")
        .field("multisig_is_active", &MoneroWasmWallet::MultisigStatus::multisig_is_active)
        .field("kex_is_done", &MoneroWasmWallet::MultisigStatus::kex_is_done)
        .field("is_ready", &MoneroWasmWallet::MultisigStatus::is_ready)
        .field("multisig_rounds_passed", &MoneroWasmWallet::MultisigStatus::multisig_rounds_passed)
        .field("threshold", &MoneroWasmWallet::MultisigStatus::threshold)
        .field("total", &MoneroWasmWallet::MultisigStatus::total);

    emscripten::value_object<MoneroWasmWallet::PaymentDetails::Destination>("PaymentDestination")
        .field("address", &MoneroWasmWallet::PaymentDetails::Destination::address)
        .field("amount", &MoneroWasmWallet::PaymentDetails::Destination::amount);

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
        "get_monero_version_full",
        emscripten::optional_override([]() -> std::string
                                      { return MONERO_VERSION_FULL; }));
};

int main()
{
    std::cout << "Initialing module..." << std::endl;

    tools::set_max_concurrency(1);

    // mlog_set_categories("*:TRACE");

    std::cout << "Module initialized" << std::endl;

    return 0;
}
