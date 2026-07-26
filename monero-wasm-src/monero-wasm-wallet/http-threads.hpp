#pragma once

#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/em_js.h>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <memory>
#include <mutex>
#include <string>

#include "crypto/crypto.h"

extern "C" const char *resize_std_string(std::string *str, size_t new_size);

namespace {

struct BusyFlagGuard
{
    explicit BusyFlagGuard(bool &is_busy)
        : m_is_busy(is_busy)
    {
        if (m_is_busy)
        {
            throw std::runtime_error("js_http_client::invoke called while another request is in progress");
        }
        m_is_busy = true;
    }

    ~BusyFlagGuard()
    {
        m_is_busy = false;
    }

private:
    bool &m_is_busy;
};

std::mutex g_http_config_mutex;
std::string g_http_base_url;
std::string g_http_fetch_event_channel;
std::mutex g_http_request_mutex;

enum class HttpFetchFailureState : std::int32_t
{
    None = 0,
    Error = 1,
    Timeout = 2,
    Abort = 3,
    ProtocolError = 4,
};

enum class HttpFetchLockState : std::int32_t
{
    Pending = 0,
    Done = 2,
    Error = 3,
};

alignas(4) std::atomic<std::int32_t> g_http_fetch_phase_one_lock{
    static_cast<std::int32_t>(HttpFetchLockState::Pending)};
alignas(4) std::atomic<std::int32_t> g_http_fetch_phase_two_lock{
    static_cast<std::int32_t>(HttpFetchLockState::Pending)};

std::string get_http_base_url()
{
    std::lock_guard<std::mutex> lock(g_http_config_mutex);
    return g_http_base_url;
}

std::string get_http_fetch_event_channel()
{
    std::lock_guard<std::mutex> lock(g_http_config_mutex);
    return g_http_fetch_event_channel;
}

EM_JS(int, js_http_fetch_request, (
    const char *uri_ptr, int uri_len,
    const char *method_ptr, int method_len,
    const char *body_ptr, int body_len,
    const char *base_url_ptr, int base_url_len,
    const char *channel_name_ptr, int channel_name_len,
    int timeout_ms,
    int request_id_hi,
    int request_id_lo,
    int phase_one_lock_ptr,
    int response_code_i32_ptr,
    int failure_state_i32_ptr,
    int body_size_i32_ptr,
    int mime_size_i32_ptr),
{
    const uri = UTF8ToString(uri_ptr, uri_len);
    const method = UTF8ToString(method_ptr, method_len);
    const baseUrl = UTF8ToString(base_url_ptr, base_url_len);
    const channelName =
      channel_name_len > 0 ? UTF8ToString(channel_name_ptr, channel_name_len) : "";
    // Keep in sync with HttpFetchLockState and the duplicate constants in js_http_fetch_copy_response.
    const LOCK_PENDING = 0;
    const LOCK_DONE = 2;
    const LOCK_ERROR = 3;

    try {
      if (!channelName || typeof BroadcastChannel !== 'function')
        return 0;

      const lockIndex = phase_one_lock_ptr >> 2;
      Atomics.store(new Int32Array(wasmMemory.buffer), lockIndex, LOCK_PENDING);

      if (!globalThis.__amethystHttpFetchChannels)
        globalThis.__amethystHttpFetchChannels = new Map();
      let channel = globalThis.__amethystHttpFetchChannels.get(channelName);
      if (!channel) {
        channel = new BroadcastChannel(channelName);
        globalThis.__amethystHttpFetchChannels.set(channelName, channel);
      }

      const message = {
        type: 'amethyst-http-fetch-request',
        url: uri,
        requestUrl: baseUrl + uri,
        method,
        bodyPtr: method !== 'GET' && body_len > 0 ? body_ptr : 0,
        bodyLen: method !== 'GET' && body_len > 0 ? body_len : 0,
        timeoutMs: timeout_ms,
        requestIdHi: request_id_hi >>> 0,
        requestIdLo: request_id_lo >>> 0,
        phaseOneLockPtr: phase_one_lock_ptr,
        responseCodePtr: response_code_i32_ptr,
        failureStatePtr: failure_state_i32_ptr,
        bodySizePtr: body_size_i32_ptr,
        mimeSizePtr: mime_size_i32_ptr,
      };
      channel.postMessage(message);

      for (;;) {
        const locks = new Int32Array(wasmMemory.buffer);
        const value = Atomics.load(locks, lockIndex);
        if (value === LOCK_DONE || value === LOCK_ERROR)
          return value;
        Atomics.wait(locks, lockIndex, value);
      }
    }
    catch (e)
    {
      return 0;
    }
});

EM_JS(int, js_http_fetch_copy_response, (
    const char *channel_name_ptr, int channel_name_len,
    int request_id_hi,
    int request_id_lo,
    int phase_two_lock_ptr,
    int body_size_i32_ptr,
    int mime_size_i32_ptr,
    int body_data_ptr_i32_ptr,
    int mime_data_ptr_i32_ptr),
{
    const channelName =
      channel_name_len > 0 ? UTF8ToString(channel_name_ptr, channel_name_len) : "";
    // Keep in sync with HttpFetchLockState and the duplicate constants in js_http_fetch_request.
    const LOCK_PENDING = 0;
    const LOCK_DONE = 2;
    const LOCK_ERROR = 3;

    try {
      if (!channelName || typeof BroadcastChannel !== 'function')
        return 0;

      const lockIndex = phase_two_lock_ptr >> 2;
      Atomics.store(new Int32Array(wasmMemory.buffer), lockIndex, LOCK_PENDING);

      if (!globalThis.__amethystHttpFetchChannels)
        globalThis.__amethystHttpFetchChannels = new Map();
      let channel = globalThis.__amethystHttpFetchChannels.get(channelName);
      if (!channel) {
        channel = new BroadcastChannel(channelName);
        globalThis.__amethystHttpFetchChannels.set(channelName, channel);
      }

      const message = {
        type: 'amethyst-http-fetch-copy-response',
        requestIdHi: request_id_hi >>> 0,
        requestIdLo: request_id_lo >>> 0,
        phaseTwoLockPtr: phase_two_lock_ptr,
        bodySizePtr: body_size_i32_ptr,
        mimeSizePtr: mime_size_i32_ptr,
        bodyDataPtrPtr: body_data_ptr_i32_ptr,
        mimeDataPtrPtr: mime_data_ptr_i32_ptr,
      };
      channel.postMessage(message);

      for (;;) {
        const locks = new Int32Array(wasmMemory.buffer);
        const value = Atomics.load(locks, lockIndex);
        if (value === LOCK_DONE || value === LOCK_ERROR)
          return value;
        Atomics.wait(locks, lockIndex, value);
      }
    }
    catch (e)
    {
      return 0;
    }
});

} // namespace

void set_http_base_url(const std::string &base_url)
{
    std::lock_guard<std::mutex> lock(g_http_config_mutex);
    g_http_base_url = base_url;
}

void set_http_fetch_event_channel(const std::string &channel_name)
{
    std::lock_guard<std::mutex> lock(g_http_config_mutex);
    g_http_fetch_event_channel = channel_name;
}

class js_http_client : public epee::net_utils::http::abstract_http_client
{
public:
    bool set_server(
        const std::string &address,
        boost::optional<tools::login> user,
        epee::net_utils::ssl_options_t ssl_options = epee::net_utils::ssl_support_t::e_ssl_support_autodetect)
    {
        return true;
    }
    void set_server(
        std::string host,
        std::string port,
        boost::optional<epee::net_utils::http::login> user,
        epee::net_utils::ssl_options_t ssl_options = epee::net_utils::ssl_support_t::e_ssl_support_autodetect)
    {
    }

    bool set_proxy(const std::string &address)
    {
        return true;
    }

    void set_auto_connect(bool auto_connect)
    {
    }
    bool connect(std::chrono::milliseconds timeout)
    {
        m_is_connected = true;
        return true;
    }
    bool disconnect()
    {
        m_is_connected = false;
        return true;
    }
    bool is_connected(bool *ssl = nullptr)
    {
        return m_is_connected;
    }
    bool invoke(
        const boost::string_ref uri,
        const boost::string_ref method,
        const boost::string_ref body,
        std::chrono::milliseconds timeout,
        const epee::net_utils::http::http_response_info **ppresponse_info = nullptr,
        const epee::net_utils::http::fields_list &additional_params = epee::net_utils::http::fields_list())
    {
        BusyFlagGuard busy_guard(m_is_busy);

        if (ppresponse_info)
        {
            *ppresponse_info = std::addressof(m_response_info);
        }

        const auto timeout_count = timeout.count();
        const auto timeout_max = static_cast<decltype(timeout_count)>(std::numeric_limits<int>::max());
        const int timeout_ms_for_js =
            timeout_count <= 0 ? 0
                               : (timeout_count > timeout_max ? std::numeric_limits<int>::max()
                                                              : static_cast<int>(timeout_count));

        const std::string base_url = get_http_base_url();
        const std::string channel_name = get_http_fetch_event_channel();

        const auto request_id = crypto::rand<std::uint64_t>();
        const auto request_id_hi = static_cast<std::uint32_t>(request_id >> 32);
        const auto request_id_lo = static_cast<std::uint32_t>(request_id);
        std::atomic<std::int32_t> response_code{0};
        std::atomic<std::int32_t> failure_state{static_cast<std::int32_t>(HttpFetchFailureState::ProtocolError)};
        std::atomic<std::int32_t> body_size{0};
        std::atomic<std::int32_t> mime_size{0};
        std::atomic<std::int32_t> body_data_ptr{0};
        std::atomic<std::int32_t> mime_data_ptr{0};

        // The UI thread owns browser fetch for pthread builds. This worker sends
        // request metadata, sleeps on phase one while the UI downloads, allocates
        // response strings after it knows the byte counts, then sleeps on phase
        // two while the UI copies bytes into the fresh WASM memory buffer.
        std::lock_guard<std::mutex> request_lock(g_http_request_mutex);

        const int phase_one_ok =
            js_http_fetch_request(
                uri.data(), static_cast<int>(uri.size()),
                method.data(), static_cast<int>(method.size()),
                body.data(), static_cast<int>(body.size()),
                base_url.data(), static_cast<int>(base_url.size()),
                channel_name.data(), static_cast<int>(channel_name.size()),
                timeout_ms_for_js,
                static_cast<int>(request_id_hi),
                static_cast<int>(request_id_lo),
                reinterpret_cast<int>(std::addressof(g_http_fetch_phase_one_lock)),
                reinterpret_cast<int>(std::addressof(response_code)),
                reinterpret_cast<int>(std::addressof(failure_state)),
                reinterpret_cast<int>(std::addressof(body_size)),
                reinterpret_cast<int>(std::addressof(mime_size)));

        m_response_info.m_response_code = response_code.load(std::memory_order_acquire);
        const auto failure = static_cast<HttpFetchFailureState>(failure_state.load(std::memory_order_acquire));
        const auto body_size_value = body_size.load(std::memory_order_acquire);
        const auto mime_size_value = mime_size.load(std::memory_order_acquire);

        if (phase_one_ok != static_cast<std::int32_t>(HttpFetchLockState::Done) || failure != HttpFetchFailureState::None || body_size_value < 0 || mime_size_value < 0)
        {
            m_response_info.m_mime_tipe.resize(0);
            m_response_info.m_body.resize(0);
            return false;
        }

        auto *mime_ptr = resize_std_string(std::addressof(m_response_info.m_mime_tipe), static_cast<std::size_t>(mime_size_value));
        auto *body_ptr = resize_std_string(std::addressof(m_response_info.m_body), static_cast<std::size_t>(body_size_value));
        mime_data_ptr.store(static_cast<std::int32_t>(reinterpret_cast<std::uintptr_t>(mime_ptr)), std::memory_order_release);
        body_data_ptr.store(static_cast<std::int32_t>(reinterpret_cast<std::uintptr_t>(body_ptr)), std::memory_order_release);

        if (body_size_value > 0 || mime_size_value > 0)
        {
            const int phase_two_ok =
                js_http_fetch_copy_response(
                    channel_name.data(), static_cast<int>(channel_name.size()),
                    static_cast<int>(request_id_hi),
                    static_cast<int>(request_id_lo),
                    reinterpret_cast<int>(std::addressof(g_http_fetch_phase_two_lock)),
                    reinterpret_cast<int>(std::addressof(body_size)),
                    reinterpret_cast<int>(std::addressof(mime_size)),
                    reinterpret_cast<int>(std::addressof(body_data_ptr)),
                    reinterpret_cast<int>(std::addressof(mime_data_ptr)));
            if (phase_two_ok != static_cast<std::int32_t>(HttpFetchLockState::Done))
            {
                m_response_info.m_mime_tipe.resize(0);
                m_response_info.m_body.resize(0);
                m_response_info.m_response_code = 0;
                return false;
            }
        }

        return m_response_info.m_response_code != 0;
    }
    bool invoke_get(
        const boost::string_ref uri,
        std::chrono::milliseconds timeout,
        const std::string &body = std::string(),
        const epee::net_utils::http::http_response_info **ppresponse_info = nullptr,
        const epee::net_utils::http::fields_list &additional_params = epee::net_utils::http::fields_list())
    {
        return invoke(uri, "GET", body, timeout, ppresponse_info, additional_params);
    }
    bool invoke_post(
        const boost::string_ref uri,
        const std::string &body,
        std::chrono::milliseconds timeout,
        const epee::net_utils::http::http_response_info **ppresponse_info = nullptr,
        const epee::net_utils::http::fields_list &additional_params = epee::net_utils::http::fields_list())
    {
        return invoke(uri, "POST", body, timeout, ppresponse_info, additional_params);
    }
    uint64_t get_bytes_sent() const
    {
        return 0;
    }
    uint64_t get_bytes_received() const
    {
        return 0;
    }

private:
    bool m_is_connected = false;
    epee::net_utils::http::http_response_info m_response_info;
    bool m_is_busy = false;
};

class js_client_factory : public epee::net_utils::http::http_client_factory
{
public:
    ~js_client_factory() {}
    std::unique_ptr<epee::net_utils::http::abstract_http_client> create()
    {
        return std::unique_ptr<epee::net_utils::http::abstract_http_client>(new js_http_client());
    }
};

extern "C"
{
    const char *EMSCRIPTEN_KEEPALIVE resize_std_string(std::string *str, size_t new_size)
    {
        str->resize(new_size);
        return str->data();
    }
}
