#include <emscripten.h>
#include <emscripten/bind.h>
#include <emscripten/em_js.h>
#include <limits>

namespace {

/** Async XHR plus Asyncify lets the wallet worker pump events during RPC, so progress
 * events can reach `globalHttpConfig.onFetch`. Linked with `-sASYNCIFY` (see root CMakeLists).
 */
EM_ASYNC_JS(int, js_http_xhr_invoke, (
    const char *uri_ptr, int uri_len,
    const char *method_ptr, int method_len,
    const char *body_ptr, int body_len,
    int timeout_ms,
    int response_code_i32_ptr,
    intptr_t mime_std_string_ptr,
    intptr_t body_std_string_ptr),
{
    const uri = UTF8ToString(uri_ptr, uri_len);
    const method = UTF8ToString(method_ptr, method_len);
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

    const config = globalThis.globalHttpConfig;
    const reqId = Math.random().toString(16).slice(2);

    const body =
      method !== 'GET' && body_len > 0
        ? new Uint8Array(heapU8().buffer, body_ptr, body_len)
        : undefined;
    const bodyCopyNonShared = body ? new Uint8Array(body) : undefined;

    const finalUrl = config.mapUrl(uri);
    config.onFetch(uri, reqId, 'start', 0, 0);

    /** Do not invoke WASM imports (resize_std_string, HEAP*) from xhr.* handlers:
     *  while awaiting the Promise, WASM is paused in Asyncify and re-entry corrupts RPC.
     */
    const applyFailureOutcome = (state) => {
      heap32()[response_code_i32_ptr >> 2] = 0;
      resizeStdString(mime_std_string_ptr, 0);
      resizeStdString(body_std_string_ptr, 0);
      config.onFetch(uri, reqId, state, 0, 0);
    };

    try
    {
      const xhrOutcome = await new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.responseType = 'arraybuffer';
        if (timeout_ms > 0)
          xhr.timeout = timeout_ms;

        xhr.onprogress = (e) => {
          if (!e.lengthComputable)
            return;
          config.onFetch(uri, reqId, 'progress', e.loaded, e.total);
        };

        xhr.onload = () => {
          try
          {
            if (xhr.status === 0)
            {
              resolve({ ok: false, failState: 'error' });
              return;
            }

            const mimeType = xhr.getResponseHeader('Content-Type') || "";
            const mimeTypeBytes = new TextEncoder().encode(mimeType);

            const rawBody = xhr.response ? new Uint8Array(xhr.response) : new Uint8Array(0);
            resolve({
              ok: true,
              status: xhr.status,
              mimeUtf8: mimeTypeBytes,
              bodyCopy: rawBody,
            });
          }
          catch (e)
          {
            resolve({ ok: false, failState: 'error' });
          }
        };

        xhr.onerror = () => {
          resolve({ ok: false, failState: 'error' });
        };

        xhr.ontimeout = () => {
          resolve({ ok: false, failState: 'timeout' });
        };

        xhr.onabort = () => {
          resolve({ ok: false, failState: 'abort' });
        };

        try
        {
          xhr.open(method, finalUrl, true);
          xhr.send(bodyCopyNonShared);
        }
        catch (openOrSendErr)
        {
          resolve({ ok: false, failState: 'error' });
        }
      });

      if (xhrOutcome.ok !== true)
      {
        applyFailureOutcome(xhrOutcome.failState);
        return 0;
      }

      heap32()[response_code_i32_ptr >> 2] = xhrOutcome.status;

      const mimePtr = resizeStdString(mime_std_string_ptr, xhrOutcome.mimeUtf8.length);
      heapU8().set(xhrOutcome.mimeUtf8, mimePtr);

      const outBodyPtr = resizeStdString(body_std_string_ptr, xhrOutcome.bodyCopy.length);
      heapU8().set(xhrOutcome.bodyCopy, outBodyPtr);

      const len = xhrOutcome.bodyCopy.length;
      config.onFetch(uri, reqId, 'end', len, len);

      return 1;
    }
    catch (e)
    {
      applyFailureOutcome('error');
      return 0;
    }
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

        // Success/failure MUST come from the EM_ASYNC_JS return value: stack locals updated
        // during the async gap can be overwritten when Asyncify restores the saved stack frame.
        const auto timeout_count = timeout.count();
        const auto timeout_max = static_cast<decltype(timeout_count)>(std::numeric_limits<int>::max());
        const int timeout_ms_for_js =
            timeout_count <= 0 ? 0
                               : (timeout_count > timeout_max ? std::numeric_limits<int>::max()
                                                              : static_cast<int>(timeout_count));

        const int xh_ok =
            js_http_xhr_invoke(
                uri.data(), static_cast<int>(uri.size()),
                method.data(), static_cast<int>(method.size()),
                body.data(), static_cast<int>(body.size()),
                timeout_ms_for_js,
                reinterpret_cast<int>(std::addressof(m_response_info.m_response_code)),
                reinterpret_cast<intptr_t>(std::addressof(m_response_info.m_mime_tipe)),
                reinterpret_cast<intptr_t>(std::addressof(m_response_info.m_body)));
        m_is_busy = false;
        return xh_ok != 0;
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
