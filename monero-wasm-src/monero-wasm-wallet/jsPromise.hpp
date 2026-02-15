
#include <emscripten.h>
#include <emscripten/bind.h>
#include "emscripten/proxying.h"

#include <emscripten/val.h>
#include <optional>

struct PromiseTriple
{
    emscripten::val promise;
    emscripten::val resolve;
    emscripten::val reject;
};

PromiseTriple makePromise()
{
    using namespace emscripten;

    // Holder for resolve/reject we can access from C++
    val holder = val::object();

    // Create an executor that closes over `holder`
    val executor = val::global("Function").new_(std::string("holder"), std::string(R"(
            "use strict";
            return function(resolve, reject) {
                holder._resolve = resolve;
                holder._reject  = reject;
            };
        )"))(holder);

    val Promise = val::global("Promise");
    val promise = Promise.new_(executor);

    return {promise, holder["_resolve"], holder["_reject"]};
}
emscripten::val jsError(std::string text)
{
    return emscripten::val::global("Error").new_(text);
}

template <class ResultT, class WorkFn, class PackFn>
emscripten::val runAsyncPromise(
    emscripten::ProxyingQueue &queue,
    pthread_t &workerThread,
    WorkFn &&work,
    PackFn &&packToJs)
{
    auto p = makePromise();

    auto result = std::make_shared<ResultT>();
    auto error = std::make_shared<std::optional<std::string>>();

    queue.proxyCallback(
        workerThread,
        [work = std::forward<WorkFn>(work), result, error]() mutable
        {
            try
            {
                // work must fill *result (or assign) and may throw
                work(*result);
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
        [p, result, error, packToJs = std::forward<PackFn>(packToJs)]() mutable
        {
            if (error->has_value())
            {
                p.reject(jsError(error->value()));
                return;
            }
            p.resolve(packToJs(*result));
        },
        [p]()
        {
            p.reject(jsError("Thread error"));
        });

    return p.promise;
}

template <class ResultT, class WorkFn>
emscripten::val runAsyncPromise(
    emscripten::ProxyingQueue &queue,
    pthread_t &workerThread,
    WorkFn &&work)
{
    return runAsyncPromise<ResultT>(
        queue,
        workerThread,
        std::forward<WorkFn>(work),
        [](ResultT &r) -> emscripten::val
        {
            return emscripten::val(r);
        });
}
