#include <emscripten.h>
#include <emscripten/bind.h>
#include "emscripten/proxying.h"

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
    bool is_connected(bool *ssl = NULL)
    {
        printf("js_http_client(%i)::is_connected called\n", m_my_id);
        return m_is_connected;
    }
    bool invoke(
        const boost::string_ref uri,
        const boost::string_ref method,
        const boost::string_ref body,
        std::chrono::milliseconds timeout,
        const epee::net_utils::http::http_response_info **ppresponse_info = NULL,
        const epee::net_utils::http::fields_list &additional_params = epee::net_utils::http::fields_list())
    {
        if (m_is_busy)
        {
            throw std::runtime_error("js_http_client(%i)::invoke called while another request is in progress");
        }
        m_is_busy = true;

        std::string uri_str(uri.data(), uri.size());
        printf("js_http_client(%i)::invoke called with uri=%s\n", m_my_id,
               uri_str.c_str());

        *ppresponse_info = std::addressof(m_response_info);
        m_fetchProxyQueue.proxySyncWithCtx(
            m_fetchingThreadId,
            [this, &uri, &method, &body, &timeout, &additional_params](
                emscripten::ProxyingQueue::ProxyingCtx ctx)
            {
                EM_ASM({
                    const uri = UTF8ToString($0, $1);
                    const method = UTF8ToString($2, $3);
                    const bodyPtr = $4;
                    const bodySize = $5;

                    const ctxPtr = $6;

                    const response_code_i32_ptr = $7;
                    const response_mime_type_std_string_ptr = $8;
                    const response_body_std_string_ptr = $9;

                    /** @type {(p: number, newSize: number) => number} */
                    const resizeStdString = Module._resize_std_string;

                    const fetchOptions = {};
                    fetchOptions.method = method;

                    const body = method != 'GET' ? new Uint8Array(HEAPU8.buffer, bodyPtr, bodySize) : undefined;

                    // Firefox do not like when we pass a shared buffer to fetch
                    const bodyCopyNonShared = body ? new Uint8Array(body) : undefined;

                    // TODO: Pass it somehow from the factory
                    const config = window.globalHttpConfig;
                    const finalUrl = window.globalHttpConfig.mapUrl(uri);

                    const reqId = Math.random().toString(16).slice(2);
                    // console.info(`[http ${reqId}] Fetching ${finalUrl} with method ${method} and body size ${bodySize}...`);

                    const xhr = new XMLHttpRequest();
                    xhr.open(method, finalUrl, true);
                    xhr.responseType = 'arraybuffer';

                    xhr.onprogress = function(event)
                    {
                        window.globalHttpConfig.onFetch(uri, reqId, 'progress', event.loaded, event.total);
                        // console.info(`[http ${reqId}] Progress: ${event.loaded} / ${event.total}`);
                    };
                    xhr.onload = function()
                    {
                        HEAP32[response_code_i32_ptr >> 2] = xhr.status;

                        const mimeType = xhr.getResponseHeader('Content-Type') || "";
                        {
                            const mimeTypeBytes = new TextEncoder().encode(mimeType);
                            const mimeTypePtr = resizeStdString(response_mime_type_std_string_ptr, mimeTypeBytes.length);
                            HEAPU8.set(mimeTypeBytes, mimeTypePtr);
                        }

                        if (xhr.status >= 200 && xhr.status < 300)
                        {
                            const bodyBytes = new Uint8Array(xhr.response);
                            const bodyPtr = resizeStdString(response_body_std_string_ptr, bodyBytes.length);
                            HEAPU8.set(bodyBytes, bodyPtr);
                        }
                        else
                        {
                            HEAP32[response_code_i32_ptr >> 2] = 500;
                            resizeStdString(response_mime_type_std_string_ptr, 0);
                            resizeStdString(response_body_std_string_ptr, 0);
                        }

                        window.globalHttpConfig.onFetch(uri, reqId, 'end', 0, 0);
                        Module._emscripten_ctx_proxy_finish(ctxPtr);
                    };

                    xhr.onerror = function()
                    {
                        window.globalHttpConfig.onFetch(uri, reqId, 'error', 0, 0);
                        HEAP32[response_code_i32_ptr >> 2] = 500;
                        resizeStdString(response_mime_type_std_string_ptr, 0);
                        resizeStdString(response_body_std_string_ptr, 0);
                        Module._emscripten_ctx_proxy_finish(ctxPtr);
                    };

                    window.globalHttpConfig.onFetch(uri, reqId, 'start', 0, 0);

                    xhr.send(bodyCopyNonShared);

                    //
                }, // 0-5
                       uri.data(), uri.size(), method.data(), method.size(), body.data(), body.size(),
                       // 6
                       ctx.ctx,
                       // 7
                       std::addressof(m_response_info.m_response_code),
                       // 8
                       std::addressof(m_response_info.m_mime_tipe),
                       // 9
                       std::addressof(m_response_info.m_body));
            });

        m_is_busy = false;
        return true;
    }
    bool invoke_get(
        const boost::string_ref uri,
        std::chrono::milliseconds timeout,
        const std::string &body = std::string(),
        const epee::net_utils::http::http_response_info **ppresponse_info = NULL,
        const epee::net_utils::http::fields_list &additional_params = epee::net_utils::http::fields_list())
    {
        // TODO: What is CRITICAL_REGION_LOCAL
        return invoke(uri, "GET", body, timeout, ppresponse_info, additional_params);
    }
    uint64_t get_bytes_sent() const
    {
        // TODO: Count bytes
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
    emscripten::ProxyingQueue m_fetchProxyQueue;
    pthread_t m_fetchingThreadId = pthread_self();

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

    void EMSCRIPTEN_KEEPALIVE emscripten_ctx_proxy_finish(em_proxying_ctx *ctx)
    {
        emscripten_proxy_finish(ctx);
    }
}