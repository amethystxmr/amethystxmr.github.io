#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/em_js.h>
#include <limits>

namespace {

/** XHR over Asyncify (single-threaded WASM); yields until the response completes. */
EM_ASYNC_JS(int, js_http_xhr_invoke, (
    const char *uri_ptr, int uri_len,
    const char *method_ptr, int method_len,
    const char *body_ptr, int body_len,
    int timeout_ms,
    int response_code_i32_ptr,
    intptr_t mime_std_string_ptr,
    intptr_t body_std_string_ptr,
    int invoke_result_i32_ptr), {
  return Asyncify.handleSleep((wakeUp) => {
    const uri = UTF8ToString(uri_ptr, uri_len);
    const method = UTF8ToString(method_ptr, method_len);
    const resizeStdString = Module['_resize_std_string'];
    const HEAPU8 = Module['HEAPU8'];
    const HEAP32 = Module['HEAP32'];

    const config = globalThis.globalHttpConfig;

    const body =
      method !== 'GET' && body_len > 0
        ? new Uint8Array(HEAPU8.buffer, body_ptr, body_len)
        : undefined;
    const bodyCopyNonShared = body ? new Uint8Array(body) : undefined;

    const finalUrl = config.mapUrl(uri);
    const reqId = Math.random().toString(16).slice(2);

    const xhr = new XMLHttpRequest();
    xhr.open(method, finalUrl, true);
    xhr.responseType = 'arraybuffer';
    xhr.timeout = timeout_ms > 0 ? timeout_ms : 0;
    HEAP32[invoke_result_i32_ptr >> 2] = 0;

    let isFinished = false;
    const finishOnce = function(fetchState)
    {
      if (isFinished)
      {
        return;
      }
      isFinished = true;
      config.onFetch(uri, reqId, fetchState, 0, 0);
      wakeUp(HEAP32[invoke_result_i32_ptr >> 2] !== 0 ? 1 : 0);
    };

    const failRequest = function(fetchState)
    {
      HEAP32[response_code_i32_ptr >> 2] = 0;
      resizeStdString(mime_std_string_ptr, 0);
      resizeStdString(body_std_string_ptr, 0);
      finishOnce(fetchState);
    };

    xhr.onprogress = function(event)
    {
      config.onFetch(uri, reqId, 'progress', event.loaded, event.total);
    };

    xhr.onload = function()
    {
      HEAP32[invoke_result_i32_ptr >> 2] = 1;
      HEAP32[response_code_i32_ptr >> 2] = xhr.status;

      const mimeType = xhr.getResponseHeader('Content-Type') || "";
      const mimeTypeBytes = new TextEncoder().encode(mimeType);
      const mimeTypePtr = resizeStdString(mime_std_string_ptr, mimeTypeBytes.length);
      HEAPU8.set(mimeTypeBytes, mimeTypePtr);

      const rawBody = xhr.response ? new Uint8Array(xhr.response) : new Uint8Array(0);
      const outBodyPtr = resizeStdString(body_std_string_ptr, rawBody.length);
      HEAPU8.set(rawBody, outBodyPtr);

      finishOnce('end');
    };

    xhr.onerror = function()
    {
      failRequest('error');
    };

    xhr.ontimeout = function()
    {
      failRequest('timeout');
    };

    xhr.onabort = function()
    {
      failRequest('abort');
    };

    config.onFetch(uri, reqId, 'start', 0, 0);
    xhr.send(bodyCopyNonShared);
  });
});

} // namespace

class js_http_client : public epee::net_utils::http::abstract_http_client
{
public:
    js_http_client()
    {
        printf("Note: js_http_client(%i)::constructor called\n", m_my_id);
    }
    ~js_http_client()
    {
        printf("Note: js_http_client(%i)::destructor called\n", m_my_id);
    }

    bool set_server(
        const std::string &address,
        boost::optional<tools::login> user,
        epee::net_utils::ssl_options_t ssl_options = epee::net_utils::ssl_support_t::e_ssl_support_autodetect)
    {
        printf("js_http_client(%i)::set_server called with address=%s\n", m_my_id, address.c_str());
        return true;
    }
    void set_server(
        std::string host,
        std::string port,
        boost::optional<epee::net_utils::http::login> user,
        epee::net_utils::ssl_options_t ssl_options = epee::net_utils::ssl_support_t::e_ssl_support_autodetect)
    {
        printf("js_http_client(%i)::set_server called with host=%s, port=%s\n", m_my_id, host.c_str(), port.c_str());
    }

    bool set_proxy(const std::string &address)
    {
        printf("js_http_client(%i)::set_proxy called with address=%s\n", m_my_id, address.c_str());
        return true;
    }

    void set_auto_connect(bool auto_connect)
    {
        printf("js_http_client(%i)::set_auto_connect called with auto_connect=%d\n", m_my_id, auto_connect);
    }
    bool connect(std::chrono::milliseconds timeout)
    {
        printf("js_http_client(%i)::connect called with timeout=%lld ms\n", m_my_id, timeout.count());
        m_is_connected = true;
        return true;
    }
    bool disconnect()
    {
        printf("js_http_client(%i)::disconnect called\n", m_my_id);
        m_is_connected = false;
        return true;
    }
    bool is_connected(bool *ssl = nullptr)
    {
        printf("js_http_client(%i)::is_connected called\n", m_my_id);
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

        std::string uri_str(uri.data(), uri.size());
        printf("js_http_client(%i)::invoke called with uri=%s\n", m_my_id,
               uri_str.c_str());

        if (ppresponse_info)
        {
            *ppresponse_info = std::addressof(m_response_info);
        }

        int invoke_result = 0;
        const auto timeout_count = timeout.count();
        const auto timeout_max = static_cast<decltype(timeout_count)>(std::numeric_limits<int>::max());
        const int timeout_ms_for_js =
            timeout_count <= 0 ? 0
                               : (timeout_count > timeout_max ? std::numeric_limits<int>::max()
                                                              : static_cast<int>(timeout_count));

        js_http_xhr_invoke(
            uri.data(), static_cast<int>(uri.size()),
            method.data(), static_cast<int>(method.size()),
            body.data(), static_cast<int>(body.size()),
            timeout_ms_for_js,
            reinterpret_cast<int>(std::addressof(m_response_info.m_response_code)),
            reinterpret_cast<intptr_t>(std::addressof(m_response_info.m_mime_tipe)),
            reinterpret_cast<intptr_t>(std::addressof(m_response_info.m_body)),
            reinterpret_cast<int>(std::addressof(invoke_result)));
        m_is_busy = false;
        return invoke_result != 0;
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
        printf("my-demo: js_http_client(%i)::get_bytes_sent called\n", m_my_id);
        return 0;
    }
    uint64_t get_bytes_received() const
    {
        printf("my-demo: js_http_client(%i)::get_bytes_received called\n", m_my_id);
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
    const char *EMSCRIPTEN_KEEPALIVE resize_std_string(std::string *str, size_t new_size)
    {
        str->resize(new_size);
        return str->data();
    }
}
