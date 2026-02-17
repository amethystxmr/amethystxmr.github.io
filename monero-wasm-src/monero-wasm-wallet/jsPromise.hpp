#pragma once

#include <emscripten/val.h>
#include <string>
#include <utility>

struct PromiseTriple
{
    emscripten::val promise;
    emscripten::val resolve;
    emscripten::val reject;
};

inline auto makePromise()
{
    using namespace emscripten;

    auto holder = val::object();
    auto executor = val::global("Function").new_(std::string("holder"), std::string(R"(
            "use strict";
            return function(resolve, reject) {
                holder._resolve = resolve;
                holder._reject  = reject;
            };
        )"))(holder);

    auto Promise = val::global("Promise");
    auto promise = Promise.new_(executor);

    return PromiseTriple{promise, holder["_resolve"], holder["_reject"]};
}

inline auto jsError(std::string text)
{
    return emscripten::val::global("Error").new_(std::move(text));
}
