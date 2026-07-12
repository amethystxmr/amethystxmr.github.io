#pragma once

#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/em_js.h>
#include <emscripten/eventloop.h>
#include <emscripten/proxying.h>
#include <limits>
#include <condition_variable>
#include <mutex>
#include <string>
#include <thread>

namespace {

struct BusyFlagGuard
{
    explicit BusyFlagGuard(bool &is_busy)
        : m_is_busy(is_busy)
    {
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

EM_JS(void, js_http_start_proxy_queue_heartbeat, (intptr_t queue_ptr), {
    const intervalId = setInterval(() => {
      if (typeof ABORT !== 'undefined' && ABORT) {
        clearInterval(intervalId);
        return;
      }
      Module['_amethyst_http_proxy_execute_queue'](queue_ptr);
    }, 50);
});

EM_JS(void, js_http_finish_proxy_ctx, (intptr_t ctx_ptr), {
    Module['_amethyst_http_proxy_finish'](ctx_ptr);
});

EM_JS(int, js_http_xhr_invoke, (
    const char *uri_ptr, int uri_len,
    const char *method_ptr, int method_len,
    const char *body_ptr, int body_len,
    const char *base_url_ptr, int base_url_len,
    const char *channel_name_ptr, int channel_name_len,
    int timeout_ms,
    int response_code_i32_ptr,
    intptr_t mime_std_string_ptr,
    intptr_t body_std_string_ptr,
    intptr_t proxy_ctx_ptr),
{
    const uri = UTF8ToString(uri_ptr, uri_len);
    const method = UTF8ToString(method_ptr, method_len);
    const baseUrl = UTF8ToString(base_url_ptr, base_url_len);
    const channelName =
      channel_name_len > 0 ? UTF8ToString(channel_name_ptr, channel_name_len) : "";
    const resizeStdString = Module['_resize_std_string'];
    const heapU8 = () => {
      if (typeof growMemViews === 'function')
        growMemViews();
      return HEAPU8;
    };
    const heap32 = () => {
      if (typeof growMemViews === 'function')
        growMemViews();
      return HEAP32;
    };

    const reqId = Math.random().toString(16).slice(2);
    const finalUrl = baseUrl + uri;
    const finish = () => js_http_finish_proxy_ctx(proxy_ctx_ptr);
    const postFetch = (state, loaded, total) => {
      if (!channelName || typeof BroadcastChannel !== 'function')
        return;
      try {
        if (!globalThis.__amethystHttpFetchChannels)
          globalThis.__amethystHttpFetchChannels = new Map();
        let channel = globalThis.__amethystHttpFetchChannels.get(channelName);
        if (!channel) {
          channel = new BroadcastChannel(channelName);
          globalThis.__amethystHttpFetchChannels.set(channelName, channel);
        }
        channel.postMessage({ url: uri, reqId, state, progressLoaded: loaded, progressTotal: total });
      }
      catch (e) {
        // HTTP must continue even if progress delivery is unavailable.
      }
    };
    const clearResponse = (state) => {
      heap32()[response_code_i32_ptr >> 2] = 0;
      resizeStdString(mime_std_string_ptr, 0);
      resizeStdString(body_std_string_ptr, 0);
      postFetch(state, 0, 0);
    };

    try
    {
      const body =
        method !== 'GET' && body_len > 0
          ? new Uint8Array(heapU8().buffer, body_ptr, body_len)
          : undefined;
      const bodyCopyNonShared = body ? new Uint8Array(body) : undefined;

      postFetch('start', 0, 0);

      const xhr = new XMLHttpRequest();
      xhr.open(method, finalUrl, true);
      xhr.responseType = 'arraybuffer';
      if (timeout_ms > 0)
        xhr.timeout = timeout_ms;

      xhr.onprogress = (e) => {
        if (e.lengthComputable)
          postFetch('progress', e.loaded, e.total);
      };

      xhr.onload = () => {
        try
        {
          if (xhr.status === 0)
          {
            clearResponse('error');
            return;
          }

          heap32()[response_code_i32_ptr >> 2] = xhr.status;

          const mimeType = xhr.getResponseHeader('Content-Type') || "";
          const mimeTypeBytes = new TextEncoder().encode(mimeType);
          const mimePtr = resizeStdString(mime_std_string_ptr, mimeTypeBytes.length);
          heapU8().set(mimeTypeBytes, mimePtr);

          const bodyBytes = xhr.response ? new Uint8Array(xhr.response) : new Uint8Array(0);
          const responseBodyPtr = resizeStdString(body_std_string_ptr, bodyBytes.length);
          heapU8().set(bodyBytes, responseBodyPtr);

          postFetch('end', bodyBytes.length, bodyBytes.length);
        }
        catch (e)
        {
          clearResponse('error');
        }
        finally
        {
          finish();
        }
      };

      xhr.onerror = () => {
        clearResponse('error');
        finish();
      };
      xhr.ontimeout = () => {
        clearResponse('timeout');
        finish();
      };
      xhr.onabort = () => {
        clearResponse('abort');
        finish();
      };

      xhr.send(bodyCopyNonShared);
      return 1;
    }
    catch (e)
    {
      clearResponse('error');
      finish();
      return 0;
    }
});

class HttpFetchWorker
{
public:
    HttpFetchWorker()
    {
        std::thread thread([this]() {
            {
                std::lock_guard<std::mutex> lock(m_mutex);
                m_started = true;
            }
            m_cond.notify_all();

            js_http_start_proxy_queue_heartbeat(reinterpret_cast<intptr_t>(m_queue.queue));
            emscripten_runtime_keepalive_push();
        });
        m_thread_handle = thread.native_handle();
        thread.detach();

        std::unique_lock<std::mutex> lock(m_mutex);
        m_cond.wait(lock, [this]() { return m_started; });
    }

    bool proxy_http_request(const std::function<void(emscripten::ProxyingQueue::ProxyingCtx)> &func)
    {
        return m_queue.proxySyncWithCtx(m_thread_handle, func);
    }

private:
    emscripten::ProxyingQueue m_queue;
    pthread_t m_thread_handle = 0;
    bool m_started = false;
    std::mutex m_mutex;
    std::condition_variable m_cond;
};

HttpFetchWorker &get_http_fetch_worker()
{
    static HttpFetchWorker worker;
    return worker;
}

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
    js_http_client()
    {
        // printf("Note: js_http_client(%i)::constructor called\n", m_my_id);
    }
    ~js_http_client()
    {
        // printf("Note: js_http_client(%i)::destructor called\n", m_my_id);
    }

    bool set_server(
        const std::string &address,
        boost::optional<tools::login> user,
        epee::net_utils::ssl_options_t ssl_options = epee::net_utils::ssl_support_t::e_ssl_support_autodetect)
    {
        // printf("js_http_client(%i)::set_server called with address=%s\n", m_my_id, address.c_str());
        return true;
    }
    void set_server(
        std::string host,
        std::string port,
        boost::optional<epee::net_utils::http::login> user,
        epee::net_utils::ssl_options_t ssl_options = epee::net_utils::ssl_support_t::e_ssl_support_autodetect)
    {
        // printf("js_http_client(%i)::set_server called with host=%s, port=%s\n", m_my_id, host.c_str(), port.c_str());
    }

    bool set_proxy(const std::string &address)
    {
        // printf("js_http_client(%i)::set_proxy called with address=%s\n", m_my_id, address.c_str());
        return true;
    }

    void set_auto_connect(bool auto_connect)
    {
        // printf("js_http_client(%i)::set_auto_connect called with auto_connect=%d\n", m_my_id, auto_connect);
    }
    bool connect(std::chrono::milliseconds timeout)
    {
        // printf("js_http_client(%i)::connect called with timeout=%lld ms\n", m_my_id, timeout.count());
        m_is_connected = true;
        return true;
    }
    bool disconnect()
    {
        // printf("js_http_client(%i)::disconnect called\n", m_my_id);
        m_is_connected = false;
        return true;
    }
    bool is_connected(bool *ssl = nullptr)
    {
        // printf("js_http_client(%i)::is_connected called\n", m_my_id);
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
        if (m_is_busy)
        {
            throw std::runtime_error("js_http_client::invoke called while another request is in progress");
        }
        m_is_busy = true;
        BusyFlagGuard busy_guard(m_is_busy);

        // std::string uri_str(uri.data(), uri.size());
        // printf("js_http_client(%i)::invoke called with uri=%s\n", m_my_id,
        //        uri_str.c_str());

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
        int xhr_started = 0;

        // Serialize daemon HTTP requests because the UI exposes a single fetch
        // progress indicator. Parallel requests would produce ambiguous progress
        // events and overwrite the visible request state.
        std::lock_guard<std::mutex> request_lock(g_http_request_mutex);
        const bool proxied = get_http_fetch_worker().proxy_http_request([&](emscripten::ProxyingQueue::ProxyingCtx ctx) {
            xhr_started =
                js_http_xhr_invoke(
                    uri.data(), static_cast<int>(uri.size()),
                    method.data(), static_cast<int>(method.size()),
                    body.data(), static_cast<int>(body.size()),
                    base_url.data(), static_cast<int>(base_url.size()),
                    channel_name.data(), static_cast<int>(channel_name.size()),
                    timeout_ms_for_js,
                    reinterpret_cast<int>(std::addressof(m_response_info.m_response_code)),
                    reinterpret_cast<intptr_t>(std::addressof(m_response_info.m_mime_tipe)),
                    reinterpret_cast<intptr_t>(std::addressof(m_response_info.m_body)),
                    reinterpret_cast<intptr_t>(ctx.ctx));
        });

        return proxied && xhr_started != 0 && m_response_info.m_response_code != 0;
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
        // printf("my-demo: js_http_client(%i)::get_bytes_sent called\n", m_my_id);
        return 0;
    }
    uint64_t get_bytes_received() const
    {
        // printf("my-demo: js_http_client(%i)::get_bytes_received called\n", m_my_id);
        return 0;
    }

private:
    bool m_is_connected = false;
    epee::net_utils::http::http_response_info m_response_info;
    bool m_is_busy = false;

    inline static int m_next_id = 1;
    int m_my_id = m_next_id++;
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
    void EMSCRIPTEN_KEEPALIVE amethyst_http_proxy_execute_queue(intptr_t queue_ptr)
    {
        emscripten_proxy_execute_queue(reinterpret_cast<em_proxying_queue *>(queue_ptr));
    }

    void EMSCRIPTEN_KEEPALIVE amethyst_http_proxy_finish(intptr_t ctx_ptr)
    {
        emscripten_proxy_finish(reinterpret_cast<em_proxying_ctx *>(ctx_ptr));
    }

    const char *EMSCRIPTEN_KEEPALIVE resize_std_string(std::string *str, size_t new_size)
    {
        str->resize(new_size);
        return str->data();
    }
}
