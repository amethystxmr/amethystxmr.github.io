if(EMSCRIPTEN)
    if(NOT DEFINED BUILD_DEPENDS_FOLDER OR BUILD_DEPENDS_FOLDER STREQUAL "")
        message(FATAL_ERROR "BUILD_DEPENDS_FOLDER must be provided")
    endif()
    set(CMAKE_CMD emcmake cmake)
    set(CONFIGURE_CMD emconfigure ./configure)
    set(MAKE_CMD emmake make)
else()
    if(NOT DEFINED BUILD_DEPENDS_FOLDER OR BUILD_DEPENDS_FOLDER STREQUAL "")
        message(FATAL_ERROR "BUILD_DEPENDS_FOLDER must be provided")
    endif()
    set(CMAKE_CMD cmake)
    set(CONFIGURE_CMD ./configure)
    set(MAKE_CMD make)
endif()

set(BUILD_DEPENDS_ROOT "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}")
file(MAKE_DIRECTORY "${BUILD_DEPENDS_ROOT}")

function(read_depends_package_meta package out_version out_file_name)
    set(DEPENDS_DIR "${CMAKE_SOURCE_DIR}/monero/contrib/depends")
    if(NOT EXISTS "${DEPENDS_DIR}/Makefile")
        message(FATAL_ERROR "Missing contrib depends Makefile at ${DEPENDS_DIR}")
    endif()

    # Query package metadata from contrib/depends via a temporary evaluated make target.
    # The extra escaping preserves `$` through CMake -> shell -> make parsing layers.
    execute_process(
        COMMAND bash -lc "make -s --eval 'print-meta: ; @echo \\$(${package}_version); echo \\$(${package}_download_file)' print-meta"
        WORKING_DIRECTORY "${DEPENDS_DIR}"
        RESULT_VARIABLE DEPENDS_META_RC
        OUTPUT_VARIABLE DEPENDS_META_OUT
        ERROR_VARIABLE DEPENDS_META_ERR
        OUTPUT_STRIP_TRAILING_WHITESPACE
    )
    if(NOT DEPENDS_META_RC EQUAL 0)
        message(FATAL_ERROR "Failed to read ${package} metadata from contrib/depends.\n${DEPENDS_META_ERR}")
    endif()

    string(REPLACE "\r\n" "\n" DEPENDS_META_OUT "${DEPENDS_META_OUT}")
    string(REPLACE "\n" ";" DEPENDS_META_LINES "${DEPENDS_META_OUT}")
    list(LENGTH DEPENDS_META_LINES DEPENDS_META_LEN)
    if(NOT DEPENDS_META_LEN EQUAL 2)
        message(FATAL_ERROR "Unexpected metadata format for ${package}: '${DEPENDS_META_OUT}'")
    endif()

    list(GET DEPENDS_META_LINES 0 PACKAGE_VERSION)
    list(GET DEPENDS_META_LINES 1 PACKAGE_FILE_NAME)
    if(PACKAGE_VERSION STREQUAL "" OR PACKAGE_FILE_NAME STREQUAL "")
        message(FATAL_ERROR "Incomplete metadata from contrib/depends for ${package}: '${DEPENDS_META_OUT}'")
    endif()

    set(${out_version} "${PACKAGE_VERSION}" PARENT_SCOPE)
    set(${out_file_name} "${PACKAGE_FILE_NAME}" PARENT_SCOPE)
endfunction()

function(find_boost_source_subdir boost_extract_dir out_subdir)
    file(GLOB BOOST_DIR_CANDIDATES RELATIVE "${boost_extract_dir}" "${boost_extract_dir}/boost*")
    foreach(candidate IN LISTS BOOST_DIR_CANDIDATES)
        if(IS_DIRECTORY "${boost_extract_dir}/${candidate}"
           AND EXISTS "${boost_extract_dir}/${candidate}/boost/type_traits/is_unsigned.hpp")
            set(${out_subdir} "${candidate}" PARENT_SCOPE)
            return()
        endif()
    endforeach()
    set(${out_subdir} "" PARENT_SCOPE)
endfunction()

function(apply_patch_with_reverse_check target_dir patch_file patch_label)
    # `patch` uses hunk context matching (with fuzz), so it tolerates line shifts
    # better than direct line-number anchored edits across minor upstream updates.
    execute_process(
        COMMAND patch --batch --forward --dry-run -F 3 -p1 -i "${patch_file}"
        WORKING_DIRECTORY "${target_dir}"
        RESULT_VARIABLE PATCH_FWD_DRY_RC
        OUTPUT_QUIET
        ERROR_QUIET
    )
    if(PATCH_FWD_DRY_RC EQUAL 0)
        execute_process(
            COMMAND patch --batch --forward -F 3 -p1 -i "${patch_file}"
            WORKING_DIRECTORY "${target_dir}"
            RESULT_VARIABLE PATCH_APPLY_RC
        )
        if(NOT PATCH_APPLY_RC EQUAL 0)
            message(FATAL_ERROR "Failed to apply ${patch_label}: ${patch_file}")
        endif()
        return()
    endif()

    execute_process(
        COMMAND patch --batch --reverse --dry-run -F 3 -p1 -i "${patch_file}"
        WORKING_DIRECTORY "${target_dir}"
        RESULT_VARIABLE PATCH_REV_DRY_RC
        OUTPUT_QUIET
        ERROR_QUIET
    )
    if(PATCH_REV_DRY_RC EQUAL 0)
        message(STATUS "Patch already applied (${patch_label}): ${patch_file}")
        return()
    endif()

    message(FATAL_ERROR "Patch does not apply cleanly (${patch_label}): ${patch_file}")
endfunction()



#
#
# ==============================================================================================

# == Boost ==
read_depends_package_meta(boost BOOST_VERSION BOOST_ARCHIVE_NAME)

set(BOOST_ARCHIVE "${CMAKE_SOURCE_DIR}/monero/contrib/depends/sources/${BOOST_ARCHIVE_NAME}")
set(BOOST_EXTRACT_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/boost")
file(MAKE_DIRECTORY "${BOOST_EXTRACT_DIR}")
message(STATUS "Using Boost from ${BOOST_EXTRACT_DIR}")

find_boost_source_subdir("${BOOST_EXTRACT_DIR}" BOOST_WITH_VERSION)
if(BOOST_WITH_VERSION STREQUAL "")
    message(STATUS " =========== Extracting Boost...")
    file(ARCHIVE_EXTRACT
        INPUT "${BOOST_ARCHIVE}"
        DESTINATION "${BOOST_EXTRACT_DIR}"
    )
    find_boost_source_subdir("${BOOST_EXTRACT_DIR}" BOOST_WITH_VERSION)
    if(BOOST_WITH_VERSION STREQUAL "")
        message(FATAL_ERROR "Could not detect extracted Boost source dir in ${BOOST_EXTRACT_DIR}")
    endif()
endif()
set(BOOST_ROOT "${BOOST_EXTRACT_DIR}/${BOOST_WITH_VERSION}" CACHE PATH "" FORCE)
set(Boost_INCLUDE_DIR "${BOOST_ROOT}" CACHE PATH "" FORCE)

set(BOOST_PATCH_DIR "${CMAKE_SOURCE_DIR}/patches/boost")
if(EXISTS "${BOOST_PATCH_DIR}")
    file(GLOB BOOST_PATCH_FILES "${BOOST_PATCH_DIR}/*.patch")
    list(SORT BOOST_PATCH_FILES)
    foreach(boost_patch IN LISTS BOOST_PATCH_FILES)
        apply_patch_with_reverse_check("${BOOST_ROOT}" "${boost_patch}" "boost")
    endforeach()
endif()

message(STATUS " BOOST_ROOT='${BOOST_ROOT}'")
set(Boost_NO_SYSTEM_PATHS ON CACHE BOOL "" FORCE)
find_package(Boost REQUIRED)

include_directories(SYSTEM ${Boost_INCLUDE_DIRS})

# TODO: Review variables below; may be redundant with above

set(BOOST_INSTALL_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/boost-install")
file(MAKE_DIRECTORY "${BOOST_INSTALL_DIR}")
if(NOT EXISTS "${BOOST_INSTALL_DIR}/lib/libboost_program_options.a" OR
   NOT EXISTS "${BOOST_INSTALL_DIR}/lib/libboost_locale.a" OR
   NOT EXISTS "${BOOST_INSTALL_DIR}/lib/libboost_regex.a")
    message(STATUS " =========== Building Boost...")
    set(BOOST_SRC_DIR "${BOOST_EXTRACT_DIR}/${BOOST_WITH_VERSION}")

    if(NOT EXISTS "${BOOST_SRC_DIR}/b2")
        message(STATUS " =========== Running bootstrap...")
        execute_process(
            COMMAND bash -lc "./bootstrap.sh"
            WORKING_DIRECTORY "${BOOST_SRC_DIR}"
            RESULT_VARIABLE BOOST_BOOTSTRAP_RC
        )
        if(NOT BOOST_BOOTSTRAP_RC EQUAL 0)
            message(FATAL_ERROR "Boost bootstrap.sh failed with code ${BOOST_BOOTSTRAP_RC}")
        endif()
    endif()

    if(EMSCRIPTEN)
        file(WRITE "${BOOST_SRC_DIR}/project-config.jam"
            "using clang : emscripten : ${CMAKE_CXX_COMPILER} ;
    ")
    endif()

    message(STATUS " =========== Running b2...")
    if(EMSCRIPTEN)
        set(BOOST_B2_TOOLSET "clang-emscripten")
    else()
        set(BOOST_B2_TOOLSET "clang")
    endif()
    execute_process(
        COMMAND bash -lc
        "./b2 -j$(nproc) \
        toolset=${BOOST_B2_TOOLSET} \
        link=static runtime-link=static \
        cxxflags='-O3' \
        linkflags='-O3' \
        cxxstd=14 \
        --with-program_options \
        --with-filesystem \
        --with-chrono \
        --with-system \
        --with-thread \
        --with-date_time \
        --with-serialization \
        --with-locale \
        --with-regex \
        --with-atomic \
        --prefix='${BOOST_INSTALL_DIR}' \
        install"
        WORKING_DIRECTORY "${BOOST_SRC_DIR}"
        RESULT_VARIABLE BOOST_B2_RC
    )
    if(NOT BOOST_B2_RC EQUAL 0)
        message(FATAL_ERROR "Boost b2 build/install failed with code ${BOOST_B2_RC}")
    endif()

else()
    message(STATUS " =========== Boost already built.")
endif()

set(Boost_INCLUDE_DIR "${BOOST_INSTALL_DIR}/include" CACHE PATH "" FORCE)
set(Boost_LIBRARY_DIR "${BOOST_INSTALL_DIR}/lib" CACHE PATH "" FORCE)
set(Boost_NO_SYSTEM_PATHS ON CACHE BOOL "" FORCE)
set(Boost_USE_STATIC_LIBS ON CACHE BOOL "" FORCE)

message(STATUS "BOOST_ROOT='${BOOST_ROOT}'")
message(STATUS "Boost_INCLUDE_DIR='${Boost_INCLUDE_DIR}'")
message(STATUS "Boost_LIBRARY_DIR='${Boost_LIBRARY_DIR}'")

find_package(Boost REQUIRED COMPONENTS filesystem thread date_time chrono serialization program_options locale regex)

include_directories(SYSTEM ${Boost_INCLUDE_DIRS})


#
#
# ==============================================================================================

# zeromq
include(ExternalProject)

read_depends_package_meta(zeromq ZMQ_VERSION ZMQ_ARCHIVE_NAME)
set(ZMQ_ARCHIVE "${CMAKE_SOURCE_DIR}/monero/contrib/depends/sources/${ZMQ_ARCHIVE_NAME}")
set(ZMQ_SRC_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/zeromq-src")
set(ZMQ_BINARY_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/zeromq-build")
set(ZMQ_INSTALL_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/zeromq-install")
file(MAKE_DIRECTORY "${ZMQ_SRC_DIR}")
file(MAKE_DIRECTORY "${ZMQ_BINARY_DIR}")
file(MAKE_DIRECTORY "${ZMQ_INSTALL_DIR}/include")
file(MAKE_DIRECTORY "${ZMQ_INSTALL_DIR}/lib")

if(EMSCRIPTEN)
    # Common emscripten env
    set(ZMQ_ENV
        ${CMAKE_COMMAND} -E env
        CC=emcc
        CXX=em++
        AR=emar
        RANLIB=emranlib
        NM=emnm
    )
else()
    set(ZMQ_ENV)
endif()

ExternalProject_Add(zeromq_ep
    URL "file://${ZMQ_ARCHIVE}"
    SOURCE_DIR "${ZMQ_SRC_DIR}"
    BINARY_DIR "${ZMQ_BINARY_DIR}"
    BUILD_IN_SOURCE 0


    CONFIGURE_COMMAND
    ${ZMQ_ENV} ${CMAKE_CMD}
    -S <SOURCE_DIR>
    -B <BINARY_DIR>
    -DCMAKE_BUILD_TYPE=Release
    -DCMAKE_INSTALL_PREFIX=${ZMQ_INSTALL_DIR}
    -DBUILD_SHARED=OFF
    -DBUILD_STATIC=ON
    -DWITH_TLS=OFF
    -DWITH_LIBSODIUM=OFF
    -DWITH_PERF_TOOL=OFF
    -DZMQ_BUILD_TESTS=OFF
    -DZMQ_BUILD_TESTS_TIMEOUT=OFF
    -DZMQ_BUILD_FRAMEWORK=OFF
    -DENABLE_CURVE=OFF
    -DZMQ_ENABLE_CURVE=OFF
    -DZMQ_HAVE_SO_KEEPALIVE=OFF
    -DZMQ_HAVE_EVENTFD=OFF
    -DZMQ_HAVE_IFADDRS=OFF
    -DZMQ_HAVE_GETIFADDRS=OFF
    -DZMQ_HAVE_UIO=OFF
    -DZMQ_HAVE_ACCEPT4=OFF
    -DCMAKE_C_FLAGS="-DZMQ_HAVE_UIO=1"
    -DCMAKE_CXX_FLAGS="-DZMQ_HAVE_UIO=1"

    BUILD_COMMAND
    ${ZMQ_ENV}
    ${MAKE_CMD} -C <BINARY_DIR> -j

    INSTALL_COMMAND
    ${ZMQ_ENV}
    ${MAKE_CMD} -C <BINARY_DIR> install
)

# Imported static lib
add_library(ZeroMQ::libzmq STATIC IMPORTED GLOBAL)
add_dependencies(ZeroMQ::libzmq zeromq_ep)

set_target_properties(ZeroMQ::libzmq PROPERTIES
    IMPORTED_LOCATION "${ZMQ_INSTALL_DIR}/lib/libzmq.a"
    INTERFACE_INCLUDE_DIRECTORIES "${ZMQ_INSTALL_DIR}/include"
)

# Optional compatibility vars
set(ZMQ_ROOT "${ZMQ_INSTALL_DIR}" CACHE PATH "" FORCE)
set(ZMQ_INCLUDE_DIR "${ZMQ_INSTALL_DIR}/include" CACHE PATH "" FORCE)
set(ZMQ_LIBRARY "${ZMQ_INSTALL_DIR}/lib/libzmq.a" CACHE FILEPATH "" FORCE)

include_directories(SYSTEM "${ZMQ_INSTALL_DIR}/include")



add_library(PkgConfig::libzmq ALIAS ZeroMQ::libzmq)
#
#
# ==============================================================================================

# == Libsodium ==

include(ExternalProject)

read_depends_package_meta(sodium SODIUM_VERSION SODIUM_ARCHIVE_NAME)
set(SODIUM_ARCHIVE "${CMAKE_SOURCE_DIR}/monero/contrib/depends/sources/${SODIUM_ARCHIVE_NAME}")
set(SODIUM_SRC_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/libsodium-src")
set(SODIUM_INSTALL_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/libsodium-install")
file(MAKE_DIRECTORY "${SODIUM_SRC_DIR}")
file(MAKE_DIRECTORY "${SODIUM_INSTALL_DIR}/include")
file(MAKE_DIRECTORY "${SODIUM_INSTALL_DIR}/lib")

if(EMSCRIPTEN)
    # Force autotools cross-compile mode, otherwise configure may try to run wasm test binaries.
    set(SODIUM_HOST_ARG --host=wasm32-unknown-emscripten)
else()
    set(SODIUM_HOST_ARG)
endif()

ExternalProject_Add(libsodium_ep
    URL "file://${SODIUM_ARCHIVE}"
    SOURCE_DIR "${SODIUM_SRC_DIR}"
    BUILD_IN_SOURCE 1

    # Autotools doesn't like spaces/newlines in env; keep it simple
    CONFIGURE_COMMAND
    ${CONFIGURE_CMD}
    ${SODIUM_HOST_ARG}
    --prefix=${SODIUM_INSTALL_DIR}
    --disable-shared
    --enable-static

    BUILD_COMMAND
    ${MAKE_CMD} -j

    INSTALL_COMMAND
    ${MAKE_CMD} install
)

# Create an IMPORTED library target that other targets can link to
add_library(sodium STATIC IMPORTED GLOBAL)
add_dependencies(sodium libsodium_ep)

set_target_properties(sodium PROPERTIES
    IMPORTED_LOCATION "${SODIUM_INSTALL_DIR}/lib/libsodium.a"
    INTERFACE_INCLUDE_DIRECTORIES "${SODIUM_INSTALL_DIR}/include"
)

# Optional: if your subprojects expect the old-style variables
set(sodium_LIBRARIES "${SODIUM_INSTALL_DIR}/lib/libsodium.a" CACHE FILEPATH "" FORCE)
set(sodium_INCLUDE_DIR "${SODIUM_INSTALL_DIR}/include" CACHE PATH "" FORCE)
set(SODIUM_LIBRARY "${SODIUM_INSTALL_DIR}/lib/libsodium.a" CACHE FILEPATH "" FORCE)
set(SODIUM_INCLUDE_DIR "${SODIUM_INSTALL_DIR}/include" CACHE PATH "" FORCE)


include_directories(SYSTEM ${sodium_INCLUDE_DIR})



#
#
# ==============================================================================================


# ==== openssl =====

include(ExternalProject)

read_depends_package_meta(openssl OPENSSL_VERSION OPENSSL_ARCHIVE_NAME)
set(OPENSSL_ARCHIVE "${CMAKE_SOURCE_DIR}/monero/contrib/depends/sources/${OPENSSL_ARCHIVE_NAME}")
set(OPENSSL_SRC_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/openssl-src")
set(OPENSSL_INSTALL_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/openssl-install")
file(MAKE_DIRECTORY "${OPENSSL_SRC_DIR}")
file(MAKE_DIRECTORY "${OPENSSL_INSTALL_DIR}/include")
file(MAKE_DIRECTORY "${OPENSSL_INSTALL_DIR}/lib")

# One place to define the toolchain env for OpenSSL.
# Critical: CROSS_COMPILE must be empty, otherwise OpenSSL may prefix it onto CC.
if(EMSCRIPTEN)
    set(OPENSSL_ENV
        ${CMAKE_COMMAND} -E env
        CROSS_COMPILE=
        CC=emcc
        CXX=em++
        AR=emar
        RANLIB=emranlib
        NM=emnm
    )
else()
    set(OPENSSL_ENV)
endif()

ExternalProject_Add(openssl_ep
    URL "file://${OPENSSL_ARCHIVE}"
    SOURCE_DIR "${OPENSSL_SRC_DIR}"
    BUILD_IN_SOURCE 1

    CONFIGURE_COMMAND
    ${OPENSSL_ENV}
    ./Configure
    linux-generic32
    no-shared no-dso no-asm no-tests no-ui-console no-afalgeng
    --prefix=${OPENSSL_INSTALL_DIR}
    --openssldir=${OPENSSL_INSTALL_DIR}/ssl

    BUILD_COMMAND
    ${OPENSSL_ENV}
    ${MAKE_CMD} -j

    INSTALL_COMMAND
    ${OPENSSL_ENV}
    ${MAKE_CMD} install_sw
)

# Imported libraries (static)
add_library(OpenSSL::Crypto STATIC IMPORTED GLOBAL)
add_library(OpenSSL::SSL STATIC IMPORTED GLOBAL)
add_dependencies(OpenSSL::Crypto openssl_ep)
add_dependencies(OpenSSL::SSL openssl_ep)

set_target_properties(OpenSSL::Crypto PROPERTIES
    IMPORTED_LOCATION "${OPENSSL_INSTALL_DIR}/lib/libcrypto.a"
    INTERFACE_INCLUDE_DIRECTORIES "${OPENSSL_INSTALL_DIR}/include"
)

set_target_properties(OpenSSL::SSL PROPERTIES
    IMPORTED_LOCATION "${OPENSSL_INSTALL_DIR}/lib/libssl.a"
    INTERFACE_INCLUDE_DIRECTORIES "${OPENSSL_INSTALL_DIR}/include"
)

# Optional: legacy variables if something expects FindOpenSSL-style vars
set(OPENSSL_ROOT_DIR "${OPENSSL_INSTALL_DIR}" CACHE PATH "" FORCE)
set(OPENSSL_INCLUDE_DIR "${OPENSSL_INSTALL_DIR}/include" CACHE PATH "" FORCE)
set(OPENSSL_CRYPTO_LIBRARY "${OPENSSL_INSTALL_DIR}/lib/libcrypto.a" CACHE FILEPATH "" FORCE)
set(OPENSSL_SSL_LIBRARY "${OPENSSL_INSTALL_DIR}/lib/libssl.a" CACHE FILEPATH "" FORCE)

include_directories(SYSTEM "${OPENSSL_INSTALL_DIR}/include")

find_package(OpenSSL REQUIRED)

set(OPENSSL_LIBRARIES "OpenSSL::SSL;OpenSSL::Crypto")
