#pragma once

#include <cstdint>
#include <cstddef>
#include <emscripten/val.h>
#include <vector>

/** Build a dense JS Array from a C++ vector (no embind Vector wrapper on the JS side). */
template <class T, class Fn>
emscripten::val vector_to_js_array(const std::vector<T> &items, Fn fn)
{
    auto arr = emscripten::val::array();
    for (size_t i = 0; i < items.size(); ++i)
    {
        arr.set(static_cast<std::uint32_t>(i), fn(items[i]));
    }
    return arr;
}

/** Build a dense JS Array from indices `[0, count)` (e.g. non-`std::vector` containers). */
template <class Fn>
emscripten::val indexed_to_js_array(std::size_t count, Fn fn)
{
    auto arr = emscripten::val::array();
    for (std::size_t i = 0; i < count; ++i)
    {
        arr.set(static_cast<std::uint32_t>(i), fn(i));
    }
    return arr;
}
