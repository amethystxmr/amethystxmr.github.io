
if(EMSCRIPTEN)
    set(BUILD_DEPENDS_FOLDER "built-wasm-depends")
    set(CMAKE_CMD emcmake cmake)
    set(CONFIGURE_CMD emconfigure ./configure)
    set(MAKE_CMD emmake make)
else()
    set(BUILD_DEPENDS_FOLDER "built-native-depends")
    set(CMAKE_CMD cmake)
    set(CONFIGURE_CMD ./configure)
    set(MAKE_CMD make)
endif()

set(BUILD_DEPENDS_ROOT "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}")
file(MAKE_DIRECTORY "${BUILD_DEPENDS_ROOT}")



#
#
# ==============================================================================================

# == Boost ==
set(BOOST_ARCHIVE_NAME "boost-1.89.0-b2-nodocs.tar.gz")
set(BOOST_WITH_VERSION "boost-1.89.0")

set(BOOST_ARCHIVE "${CMAKE_SOURCE_DIR}/monero/contrib/depends/sources/${BOOST_ARCHIVE_NAME}")
set(BOOST_EXTRACT_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/boost")
file(MAKE_DIRECTORY "${BOOST_EXTRACT_DIR}")
message(STATUS "Using Boost from ${BOOST_EXTRACT_DIR}")



if(NOT EXISTS "${BOOST_EXTRACT_DIR}/${BOOST_WITH_VERSION}/boost")
    message(STATUS " =========== Extracting Boost...")
    file(ARCHIVE_EXTRACT
        INPUT "${BOOST_ARCHIVE}"
        DESTINATION "${BOOST_EXTRACT_DIR}"
    )
    # TODO: Patch ${BUILD_DEPENDS_FOLDER}/boost/boost_1_84_0/boost/type_traits/is_unsigned.hpp
    # Comment those lines:
    #  static const no_cv_t minus_one = (static_cast<no_cv_t>(-1));
    #  static const no_cv_t zero = (static_cast<no_cv_t>(0));
    # And replace with (formatted of course):
    #       typedef typename boost::conditional<
    #       boost::is_enum<no_cv_t>::value,
    #      typename std::underlying_type<no_cv_t>::type,
    #      no_cv_t
    #     >::type test_t;
    #    static const test_t minus_one = static_cast<test_t>(-1);
    #    static const test_t zero      = static_cast<test_t>(0);

    if(1) # Patch the is_unsigned.hpp file
        message(STATUS "==== Pathing boost")
        set(BOOST_IS_UNSIGNED_HPP
            "${BOOST_EXTRACT_DIR}/${BOOST_WITH_VERSION}/boost/type_traits/is_unsigned.hpp"
        )


        file(COPY
            "${BOOST_IS_UNSIGNED_HPP}"
            DESTINATION "${BOOST_EXTRACT_DIR}/${BOOST_WITH_VERSION}/boost/type_traits/tmp-backups"
        )

        file(WRITE "${BOOST_EXTRACT_DIR}/boost_is_unsigned.patch" "
--- a/boost/type_traits/is_unsigned.hpp
+++ b/boost/type_traits/is_unsigned.hpp
@@ -35,8 +35,14 @@
    // the correct answer.
    //
    typedef typename remove_cv<T>::type no_cv_t;
-   static const no_cv_t minus_one = (static_cast<no_cv_t>(-1));
-   static const no_cv_t zero = (static_cast<no_cv_t>(0));
+   typedef typename boost::conditional<
+      boost::is_enum<no_cv_t>::value,
+      typename std::underlying_type<no_cv_t>::type,
+      no_cv_t
+   >::type test_t;
+
+   static const test_t minus_one = static_cast<test_t>(-1);
+   static const test_t zero      = static_cast<test_t>(0);
 };
 
 template <class T>
")


        execute_process(
            COMMAND patch --forward -p1 -i "${BOOST_EXTRACT_DIR}/boost_is_unsigned.patch"
            WORKING_DIRECTORY "${BOOST_EXTRACT_DIR}/${BOOST_WITH_VERSION}"
            RESULT_VARIABLE PATCH_RESULT
        )

        if(NOT PATCH_RESULT EQUAL 0)
            message(FATAL_ERROR "Failed to apply Boost is_unsigned.hpp patch")
        endif()

    endif()
endif()
set(BOOST_ROOT "${BOOST_EXTRACT_DIR}/${BOOST_WITH_VERSION}" CACHE PATH "" FORCE)
set(Boost_INCLUDE_DIR "${BOOST_ROOT}" CACHE PATH "" FORCE)

message(STATUS " BOOST_ROOT='${BOOST_ROOT}'")
set(Boost_NO_SYSTEM_PATHS ON CACHE BOOL "" FORCE)
find_package(Boost REQUIRED)

include_directories(SYSTEM ${Boost_INCLUDE_DIRS})

# TODO: Review variables below; may be redundant with above

set(BOOST_INSTALL_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/boost-install")
file(MAKE_DIRECTORY "${BOOST_INSTALL_DIR}")
if(NOT EXISTS "${BOOST_INSTALL_DIR}/lib/libboost_program_options.a")
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
        "./b2 -j \
        toolset=${BOOST_B2_TOOLSET} \
        target-os=none \
        link=static runtime-link=static \
        cxxflags='-O3' \
        linkflags='-O3' \
        --with-program_options \
        --with-filesystem \
        --with-chrono \
        --with-system \
        --with-thread \
        --with-date_time \
        --with-serialization \
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

find_package(Boost REQUIRED COMPONENTS filesystem thread date_time chrono serialization program_options)

include_directories(SYSTEM ${Boost_INCLUDE_DIRS})


#
#
# ==============================================================================================

# zeromq
include(ExternalProject)

set(ZMQ_ARCHIVE "${CMAKE_SOURCE_DIR}/monero/contrib/depends/sources/zeromq-4.3.5.tar.gz")
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

set(SODIUM_ARCHIVE "${CMAKE_SOURCE_DIR}/monero/contrib/depends/sources/libsodium-1.0.18.tar.gz")
set(SODIUM_SRC_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/libsodium-src")
set(SODIUM_INSTALL_DIR "${CMAKE_SOURCE_DIR}/${BUILD_DEPENDS_FOLDER}/libsodium-install")
file(MAKE_DIRECTORY "${SODIUM_SRC_DIR}")
file(MAKE_DIRECTORY "${SODIUM_INSTALL_DIR}/include")
file(MAKE_DIRECTORY "${SODIUM_INSTALL_DIR}/lib")

ExternalProject_Add(libsodium_ep
    URL "file://${SODIUM_ARCHIVE}"
    SOURCE_DIR "${SODIUM_SRC_DIR}"
    BUILD_IN_SOURCE 1

    # Autotools doesn't like spaces/newlines in env; keep it simple
    CONFIGURE_COMMAND
    ${CONFIGURE_CMD}
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


include_directories(SYSTEM ${sodium_INCLUDE_DIR})



#
#
# ==============================================================================================


# ==== openssl =====

include(ExternalProject)

set(OPENSSL_VERSION "3.5.4")
set(OPENSSL_ARCHIVE "${CMAKE_SOURCE_DIR}/monero/contrib/depends/sources/openssl-${OPENSSL_VERSION}.tar.gz")
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


