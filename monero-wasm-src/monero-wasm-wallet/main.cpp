#include <iostream>
#include <memory>
#include <algorithm>
#include "wallet/wallet2.h"
#include "wallet/api/wallet2_api.h"
#include "mnemonics/electrum-words.h"
#include <thread>
#include "memwipe.h"

#include <emscripten.h>
#include <emscripten/bind.h>
#include "emscripten/proxying.h"

#include "http.hpp"

#include <emscripten/val.h>
#include <optional>

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

    MoneroWasmWallet()
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

    emscripten::val init()
    {
        auto p = makePromise();

        auto retVal = std::make_shared<bool>(0);

        walletQueue.proxyCallback(
            walletThread,
            [this, retVal]()
            {
                auto initResult = m_wallet.init("127.1.2.3");
                *retVal = initResult;
            },
            [p, retVal]()
            {
                p.resolve(*retVal);
            },
            [p]()
            {
                p.reject(jsError("Failed to initialize wallet"));
            });

        return p.promise;
    }

    emscripten::val get_daemon_blockchain_height()
    {
        auto p = makePromise();

        auto retValInt = std::make_shared<uint64_t>(0);
        auto retValStr = std::make_shared<std::string>("");

        walletQueue.proxyCallback(
            walletThread,
            [this, retValInt, retValStr]()
            {
                std::string err;
                uint64_t blockchain_height = m_wallet.get_daemon_blockchain_height(err);
                if (err.empty())
                {
                    *retValInt = blockchain_height;
                }
                else
                {
                    *retValStr = err;
                }
            },
            [p, retValInt, retValStr]()
            {
                if (retValStr->empty())
                {
                    p.resolve(*retValInt);
                }
                else
                {
                    p.reject(jsError(*retValStr));
                }
            },
            [p]()
            {
                p.reject(jsError("Failed to get blockchain height"));
            });

        return p.promise;
    }

    emscripten::val generate(
        std::string fileName,
        std::string password,
        emscripten::val secretStr,
        bool recover,
        bool two_random)
    {
        if (secretStr["length"].as<unsigned>() != 32)
            throw std::runtime_error(std::string("Secret must be 32 bytes but got ") + std::to_string(secretStr["length"].as<unsigned>()));

        auto secretKey = std::make_shared<crypto::secret_key>();
        for (size_t i = 0; i < 32; ++i)
        {
            secretKey->data[i] = secretStr[i].as<unsigned char>();
        }

        // Result type for this async task
        using Result = crypto::secret_key;

        return runAsyncPromise<Result>(
            walletQueue,
            walletThread,

            [this,
             fileName = std::move(fileName),
             password = std::move(password),
             secretKey,
             recover,
             two_random](Result &out)
            {
                auto gen_status = m_wallet.generate(
                    fileName,
                    epee::wipeable_string(password),
                    *secretKey,
                    recover,
                    two_random);

                std::memcpy(out.data, gen_status.data, 32);
            },
            [](const Result &r) -> emscripten::val
            {
                auto v = emscripten::val::global("Uint8Array").new_(32);
                for (size_t i = 0; i < 32; ++i)
                {
                    v.set(i, r.data[i]);
                }
                return v;
            });
    }

    emscripten::val store()
    {
        return runAsyncPromise<bool>(
            walletQueue,
            walletThread,
            [this](bool &r)
            {
                m_wallet.store();
                r = true;
            },
            [](bool &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

    emscripten::val set_attribute(std::string key, std::string value)
    {
        return runAsyncPromise<bool>(
            walletQueue,
            walletThread,
            [this, key = std::move(key), value = std::move(value)](bool &r)
            {
                m_wallet.set_attribute(key, value);
                r = true;
            });
    }

    emscripten::val get_attribute(std::string key)
    {
        return runAsyncPromise<std::string>(
            walletQueue,
            walletThread,
            [this, key = std::move(key)](std::string &r)
            {
                m_wallet.get_attribute(key, r);
            });
    }

    emscripten::val load(
        std::string fileName,
        std::string password)
    {
        // This method do not call http but it might take some time, so we run it in the worker thread
        return runAsyncPromise<bool>(
            walletQueue,
            walletThread,
            [this, fileName, password](bool &r)
            {
                m_wallet.load(fileName, epee::wipeable_string(password));
                r = true;
            },
            [](bool &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

    // TODO: This actually not needed because it will close in destructor
    emscripten::val close_wallet()
    {
        return runAsyncPromise<bool>(
            walletQueue,
            walletThread,
            [this](bool &r)
            {
                m_wallet.stop();
                m_wallet.deinit();
                r = true;
            },
            [](bool &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

    emscripten::val words_to_bytes(std::string words,
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

    std::string get_address()
    {
        return m_wallet.get_address_as_str();
    }
    size_t get_num_subaddresses(uint32_t index_major) const
    {
        return m_wallet.get_num_subaddresses(index_major);
    }
    std::string get_subaddress_as_str(uint32_t m_current_subaddress_account, uint32_t index)
    {
        auto subaddr_index = cryptonote::subaddress_index{m_current_subaddress_account, index};
        return m_wallet.get_subaddress_as_str(subaddr_index);
    }
    std::string get_subaddress_label(uint32_t m_current_subaddress_account, uint32_t index)
    {
        return m_wallet.get_subaddress_label({m_current_subaddress_account, index});
    }
    emscripten::val add_subaddress(uint32_t index_major, const std::string &label)
    {
        return runAsyncPromise<bool>(
            walletQueue,
            walletThread,
            [this, index_major, label](bool &r)
            {
                m_wallet.add_subaddress(index_major, label);
                r = true;
            },
            [](bool &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

    emscripten::val is_synced()
    {
        return runAsyncPromise<bool>(
            walletQueue,
            walletThread,
            [this](bool &r)
            {
                r = m_wallet.is_synced();
            },
            [](bool &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

    emscripten::val get_seed(std::string seed_language, std::string seedPassphrase)
    {
        return runAsyncPromise<epee::wipeable_string>(
            walletQueue,
            walletThread,
            [this, seed_language, seedPassphrase](epee::wipeable_string &r)
            {
                m_wallet.set_seed_language(seed_language);
                auto isOk = m_wallet.get_seed(r, seedPassphrase);
                if (!isOk)
                {
                    throw std::runtime_error("Failed to get seed");
                }
            },
            [](epee::wipeable_string &r) -> emscripten::val
            {
                std::string seedStr(r.data(), r.size());
                return emscripten::val(seedStr);
            });
    }

    auto rewrite(const std::string &wallet_file, const std::string &password_str)
    {
        const epee::wipeable_string password{password_str};
        return runAsyncPromise<bool>(
            walletQueue,
            walletThread,
            [this, wallet_file, password](bool &r)
            {
                m_wallet.rewrite(wallet_file, password);
                r = true;
            });
    }

    struct RefreshResult
    {
        uint64_t blocksFetched;
        bool receivedMoney;
    };

    emscripten::val refresh(bool trusted_daemon, uint64_t start_height, bool check_pool = true, bool try_incremental = true, uint64_t max_blocks = std::numeric_limits<uint64_t>::max())
    {
        return runAsyncPromise<RefreshResult>(
            walletQueue,
            walletThread,
            [this, trusted_daemon, start_height, check_pool, try_incremental, max_blocks](RefreshResult &r)
            {
                m_wallet.refresh(trusted_daemon, start_height, r.blocksFetched, r.receivedMoney, check_pool, try_incremental, max_blocks);
            },
            [](RefreshResult &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
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
    emscripten::val get_payments(uint64_t min_height, uint64_t max_height)
    {
        using R = std::vector<PaymentDetails>;
        return runAsyncPromise<R>(
            walletQueue,
            walletThread,
            [this, min_height, max_height](R &r)
            {
                r = get_payments_impl(min_height, max_height);
            },
            [](R &r) -> emscripten::val
            {
                return emscripten::val(r);
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
                auto &payment_id = i->first;
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
                                  .tx_hash = std::string(""),
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
                    .tx_hash = std::string(""),
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

    emscripten::val get_payments_mempool()
    {
        using R = std::vector<PaymentDetails>;
        return runAsyncPromise<R>(
            walletQueue,
            walletThread,
            [this](R &r)
            {
                r = get_payments_mempool_impl();
            },
            [](R &r) -> emscripten::val
            {
                return emscripten::val(r);
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

    emscripten::val transfer_prepare(std::string dst_address, uint64_t amount, uint32_t priority)
    {
        using R = std::shared_ptr<std::vector<tools::wallet2::pending_tx>>;
        return runAsyncPromise<R>(
            walletQueue,
            walletThread,
            [this, dst_address, amount, priority](R &r)
            {
                r = transfer_impl(dst_address, amount, priority);
            },
            [](R &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

    uint64_t transfer_get_fee(std::shared_ptr<std::vector<tools::wallet2::pending_tx>> ptx_vector)
    {
        uint64_t total_fee = 0;
        for (size_t n = 0; n < ptx_vector->size(); ++n)
        {
            total_fee += (*ptx_vector)[n].fee;
        }
        return total_fee;
    }

    emscripten::val transfer_commit_tx(std::shared_ptr<std::vector<tools::wallet2::pending_tx>> ptx_vector)
    {

        return runAsyncPromise<bool>(
            walletQueue,
            walletThread,
            [this, ptx_vector](bool &r)
            {
                m_wallet.commit_tx(*ptx_vector);
                ;
                r = true;
            },
            [](bool &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

    std::shared_ptr<std::vector<tools::wallet2::pending_tx>> transfer_impl(std::string dst_address, uint64_t amount, uint32_t priority)
    {

        cryptonote::address_parse_info info;
        auto r = cryptonote::get_account_address_from_str(info, m_wallet.nettype(), dst_address);
        if (!r)
        {
            throw std::runtime_error("Invalid destination address");
        };

        cryptonote::tx_destination_entry de;
        de.addr = info.address;
        de.is_subaddress = info.is_subaddress;
        de.is_integrated = info.has_payment_id;
        de.amount = amount;

        std::vector<cryptonote::tx_destination_entry> dsts = {de};

        const size_t min_ring_size = m_wallet.get_min_ring_size();
        size_t fake_outs_count = min_ring_size - 1;

        std::vector<uint8_t> extra;
        std::set<uint32_t> subaddr_indices;

        auto ptx_vector = m_wallet.create_transactions_2(dsts, fake_outs_count,
                                                         static_cast<tools::fee_priority>(priority),
                                                         extra,
                                                         0, subaddr_indices);
        if (ptx_vector.empty())
        {
            throw std::runtime_error("No outputs found, or daemon is not ready");
        }

        return std::make_shared<std::vector<tools::wallet2::pending_tx>>(std::move(ptx_vector));
    }

    std::string get_wallet_file()
    {
        return m_wallet.get_wallet_file();
    }

    uint64_t balance(uint32_t index_major, bool strict)
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

    uint64_t get_blockchain_current_height()
    {
        return m_wallet.get_blockchain_current_height();
    }

    struct UnlockedBalanceResult
    {
        uint64_t balance;
        uint64_t blocks_to_unlock;
        uint64_t time_to_unlock;
    };

    struct UnlockedBalanceResult unlocked_balance(uint32_t index_major, bool strict)
    {
        UnlockedBalanceResult r;
        r.balance = m_wallet.unlocked_balance(index_major, strict, &r.blocks_to_unlock, &r.time_to_unlock);
        return r;
    }

    emscripten::val get_blockchain_height_by_date(uint16_t year, uint8_t month, uint8_t day)
    {
        return runAsyncPromise<uint64_t>(
            walletQueue,
            walletThread,
            [this, year, month, day](uint64_t &r)
            {
                r = m_wallet.get_blockchain_height_by_date(year, month, day);
            },
            [](uint64_t &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

    auto get_multisig_status()
    {
        using R = multisig::multisig_account_status;
        return runAsyncPromise<R>(
            walletQueue,
            walletThread,
            [this](R &r)
            {
                r = m_wallet.get_multisig_status();
            },
            [](R &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

    auto verify_password(const std::string &password_str)
    {
        using R = bool;
        epee::wipeable_string password(password_str);
        return runAsyncPromise<R>(
            walletQueue,
            walletThread,
            [this, password](R &r)
            {
                r = m_wallet.verify_password(password);
            });
    }

    auto make_multisig(const std::string &password_str,
                       const std::string &initial_kex_msgs,
                       std::uint32_t threshold)
    {
        using R = std::string;
        epee::wipeable_string password(password_str);
        return runAsyncPromise<R>(
            walletQueue,
            walletThread,
            [this, password, initial_kex_msgs, threshold](R &r)
            {
                if (!m_wallet.verify_password(password))
                {
                    throw std::runtime_error("invalid password");
                }

                if (m_wallet.get_multisig_status().multisig_is_active)
                {
                    throw std::runtime_error("Wallet is already multisig");
                };
                if (m_wallet.get_num_transfer_details())
                {
                    throw std::runtime_error("Wallet must be empty to create multisig");
                };
                std::vector<std::string> kex_msgs;
                if (!initial_kex_msgs.empty())
                {
                    boost::split(kex_msgs, initial_kex_msgs, boost::is_any_of(" "), boost::token_compress_on);
                }
                r = m_wallet.make_multisig(password, kex_msgs, threshold);
            });
    }

    auto exchange_multisig_keys(const std::string &password_str, const std::string &kex_msgs_str)
    {
        using R = std::string;
        epee::wipeable_string password(password_str);
        return runAsyncPromise<R>(
            walletQueue,
            walletThread,
            [this, password, kex_msgs_str](R &r)
            {
                if (!m_wallet.verify_password(password))
                {
                    throw std::runtime_error("invalid password");
                }
                if (!m_wallet.get_multisig_status().multisig_is_active)
                {
                    throw std::runtime_error("Wallet is not multisig");
                };
                std::vector<std::string> kex_msgs;
                if (!kex_msgs_str.empty())
                {
                    boost::split(kex_msgs, kex_msgs_str, boost::is_any_of(" "), boost::token_compress_on);
                }
                r = m_wallet.exchange_multisig_keys(password, kex_msgs);
            });
    }

    emscripten::val prepare_multisig()
    {
        return runAsyncPromise<std::string>(
            walletQueue,
            walletThread,
            [this](std::string &r)
            {
                if (m_wallet.get_num_transfer_details() > 0)
                {
                    throw std::runtime_error("Wallet must be empty to prepare multisig");
                }
                if (m_wallet.get_multisig_status().multisig_is_active)
                {
                    throw std::runtime_error("Wallet is already multisig");
                }
                r = m_wallet.get_multisig_first_kex_msg();
            },
            [](std::string &r) -> emscripten::val
            {
                return emscripten::val(r);
            });
    }

private:
    // TODO: Add a callback for onFetching for better UI
    tools::wallet2 m_wallet = tools::wallet2(
        cryptonote::network_type::MAINNET,
        1,
        true,
        std::unique_ptr<epee::net_utils::http::http_client_factory>(new js_client_factory()));

    pthread_t walletThread;
    emscripten::ProxyingQueue walletQueue;

    // Assuming that constructor is called in the main thread
    pthread_t mainThread = pthread_self();
    emscripten::ProxyingQueue mainThreadQueue;

    emscripten::val m_on_new_block_callback = emscripten::val::null();
};

EMSCRIPTEN_BINDINGS(monero_wasm_wallet)
{
    emscripten::class_<MoneroWasmWallet>("MoneroWasmWallet")
        .function("init", &MoneroWasmWallet::init)
        .function("get_daemon_blockchain_height", &MoneroWasmWallet::get_daemon_blockchain_height)
        .function("generate", &MoneroWasmWallet::generate)
        .function("rewrite", &MoneroWasmWallet::rewrite)
        .function("close_wallet", &MoneroWasmWallet::close_wallet)
        .function("get_address", &MoneroWasmWallet::get_address)
        .function("get_num_subaddresses", &MoneroWasmWallet::get_num_subaddresses)
        .function("get_subaddress_as_str", &MoneroWasmWallet::get_subaddress_as_str)
        .function("get_subaddress_label", &MoneroWasmWallet::get_subaddress_label)
        .function("add_subaddress", &MoneroWasmWallet::add_subaddress)
        .function("is_synced", &MoneroWasmWallet::is_synced)
        .function("set_on_new_block_callback", &MoneroWasmWallet::set_on_new_block_callback)
        .function("refresh", &MoneroWasmWallet::refresh)
        .function("load", &MoneroWasmWallet::load)
        //.function("get_transfers", &MoneroWasmWallet::get_transfers)
        .function("get_payments", &MoneroWasmWallet::get_payments)
        .function("get_payments_mempool", &MoneroWasmWallet::get_payments_mempool)
        .function("store", &MoneroWasmWallet::store)
        .function("set_attribute", &MoneroWasmWallet::set_attribute)
        .function("get_attribute", &MoneroWasmWallet::get_attribute)
        .function("get_seed", &MoneroWasmWallet::get_seed)
        .function("get_wallet_file", &MoneroWasmWallet::get_wallet_file)
        .function("balance", &MoneroWasmWallet::balance)
        .function("unlocked_balance", &MoneroWasmWallet::unlocked_balance)
        .function("set_refresh_from_block_height", &MoneroWasmWallet::set_refresh_from_block_height)
        .function("set_explicit_refresh_from_block_height", &MoneroWasmWallet::set_explicit_refresh_from_block_height)
        .function("get_blockchain_current_height", &MoneroWasmWallet::get_blockchain_current_height)
        .function("get_blockchain_height_by_date", &MoneroWasmWallet::get_blockchain_height_by_date)
        .function("words_to_bytes", &MoneroWasmWallet::words_to_bytes)
        .function("transfer_prepare", &MoneroWasmWallet::transfer_prepare)
        .function("transfer_get_fee", &MoneroWasmWallet::transfer_get_fee)
        .function("transfer_commit_tx", &MoneroWasmWallet::transfer_commit_tx)
        .function("get_multisig_status", &MoneroWasmWallet::get_multisig_status)
        .function("prepare_multisig", &MoneroWasmWallet::prepare_multisig)
        .function("make_multisig", &MoneroWasmWallet::make_multisig)
        .function("exchange_multisig_keys", &MoneroWasmWallet::exchange_multisig_keys)
        .function("verify_password", &MoneroWasmWallet::verify_password)
        .constructor();

    emscripten::class_<std::vector<tools::wallet2::pending_tx>>("VectorOfPendingTx")
        .smart_ptr<std::shared_ptr<std::vector<tools::wallet2::pending_tx>>>("VectorOfPendingTx");

    emscripten::value_object<struct multisig::multisig_account_status>("MultisigAccountStatus")
        .field("multisig_is_active", &multisig::multisig_account_status::multisig_is_active)
        .field("kex_is_done", &multisig::multisig_account_status::kex_is_done)
        .field("is_ready", &multisig::multisig_account_status::is_ready)
        .field("threshold", &multisig::multisig_account_status::threshold)
        .field("total", &multisig::multisig_account_status::total);

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

    emscripten::value_object<MoneroWasmWallet::RefreshResult>("RefreshResult")
        .field("blocksFetched", &MoneroWasmWallet::RefreshResult::blocksFetched)
        .field("receivedMoney", &MoneroWasmWallet::RefreshResult::receivedMoney);

    emscripten::value_object<MoneroWasmWallet::UnlockedBalanceResult>("UnlockedBalanceResult")
        .field("balance", &MoneroWasmWallet::UnlockedBalanceResult::balance)
        .field("blocks_to_unlock", &MoneroWasmWallet::UnlockedBalanceResult::blocks_to_unlock)
        .field("time_to_unlock", &MoneroWasmWallet::UnlockedBalanceResult::time_to_unlock);

    emscripten::function(
        "mlog_set_categories",
        emscripten::optional_override([](std::string categories) -> void
                                      { mlog_set_categories(categories.c_str()); }));
    emscripten::function(
        "set_max_concurrency",
        emscripten::optional_override([](uint32_t threads) -> void
                                      { tools::set_max_concurrency(std::max<uint32_t>(1, threads)); }));
};

int main()
{
    std::cout << "Initialing module..." << std::endl;

    tools::set_max_concurrency(2);

    // mlog_set_categories("*:TRACE");

    std::cout << "Module initialized" << std::endl;

    return 0;
}
