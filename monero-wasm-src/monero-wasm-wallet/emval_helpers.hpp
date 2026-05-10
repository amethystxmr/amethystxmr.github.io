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

/**
 * Same as `vector_to_js_array` with element mapper `emscripten::val(const Elem&)`.
 * Use for vectors of Embind `value_object` / registered types so each row becomes
 * a plain JS object in a dense Array (not `register_vector`'s Embind Vector handle).
 */
template <class Elem>
emscripten::val vector_to_js_array_val(const std::vector<Elem> &items)
{
    return vector_to_js_array(items, [](const Elem &e) { return emscripten::val(e); });
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
