# Finds all headers in a directory and its subdirs, to be able to search for them and autosave in IDEs.
#
# Parameters:
# - headers_found:    Output variable, which will hold the found headers
# - module_root_dir:  The search path for the headers. Typically it will be the module's root dir, so "${CMAKE_CURRENT_SOURCE_DIR}" or a derivative of it.
macro (monero_find_all_headers headers_found module_root_dir)
  file(GLOB ${headers_found}
           "${module_root_dir}/*.h*"    # h* will include hpps as well.
           "${module_root_dir}/**/*.h*" # Any number of subdirs will be included.
           "${module_root_dir}/*.inl"   # .inl is typically template code and is being treated as headers (it's being included).
           "${module_root_dir}/**/*.inl"
)
endmacro()

function (monero_private_headers group)
  source_group("${group}\\Private"
    FILES
      ${ARGN})
endfunction ()


function (monero_add_library name)
    monero_add_library_with_deps(NAME "${name}" SOURCES ${ARGN})
endfunction()

function (monero_add_library_with_deps)
  cmake_parse_arguments(MONERO_ADD_LIBRARY "" "NAME" "DEPENDS;SOURCES" ${ARGN})
  source_group("${MONERO_ADD_LIBRARY_NAME}" FILES ${MONERO_ADD_LIBRARY_SOURCES})

  # Define a ("virtual") object library and an actual library that links those
  # objects together. The virtual libraries can be arbitrarily combined to link
  # any subset of objects into one library archive. This is used for releasing
  # libwallet, which combines multiple components.
  set(objlib obj_${MONERO_ADD_LIBRARY_NAME})
  add_library(${objlib} OBJECT ${MONERO_ADD_LIBRARY_SOURCES})
  add_library("${MONERO_ADD_LIBRARY_NAME}" $<TARGET_OBJECTS:${objlib}>)
  monero_set_target_no_relink("${MONERO_ADD_LIBRARY_NAME}")
  monero_set_target_strip    ("${MONERO_ADD_LIBRARY_NAME}")
  if (MONERO_ADD_LIBRARY_DEPENDS)
    add_dependencies(${objlib} ${MONERO_ADD_LIBRARY_DEPENDS})
  endif()
  set_property(TARGET "${MONERO_ADD_LIBRARY_NAME}" PROPERTY FOLDER "libs")
  target_compile_definitions(${objlib}
    PRIVATE $<TARGET_PROPERTY:${MONERO_ADD_LIBRARY_NAME},INTERFACE_COMPILE_DEFINITIONS>)
endfunction ()

option(RELINK_TARGETS "Relink targets, when just a dependant .so changed, but not its header?" OFF)
function (monero_set_target_no_relink target)
  if (RELINK_TARGETS MATCHES OFF)
    # Will not relink the target, when just its dependant .so has changed, but not it's interface
    set_target_properties("${target}" PROPERTIES LINK_DEPENDS_NO_SHARED true)
  endif()
endfunction()

option(STRIP_TARGETS "Strip symbols from targets?" OFF)
function (monero_set_target_strip target)
  if (STRIP_TARGETS)
    set_target_properties("${target}" PROPERTIES LINK_FLAGS_RELEASE -s)
    set_target_properties("${target}" PROPERTIES LINK_FLAGS_DEBUG -s)
    # Stripping from Debug might make sense if you're low on disk space, but want to test if debug version builds properly.
  endif()
endfunction()


option(COVERAGE "Enable profiling for test coverage report" OFF)
if(COVERAGE)
    message(STATUS "Building with profiling for test coverage report")
endif()
macro (monero_enable_coverage)
  if(COVERAGE)
    foreach(COV_FLAG -fprofile-arcs -ftest-coverage --coverage)
      set(CMAKE_C_FLAGS   "${CMAKE_C_FLAGS}   ${COV_FLAG}")
      set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${COV_FLAG}")
    endforeach()
  endif()
endmacro()



function (monero_add_executable name)
  source_group("${name}"
    FILES
      ${ARGN})

  add_executable("${name}"
    ${ARGN})
  target_link_libraries("${name}"
    PRIVATE
      ${EXTRA_LIBRARIES})
  set_property(TARGET "${name}"
    PROPERTY
      FOLDER "prog")
  set_property(TARGET "${name}"
    PROPERTY
      RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
  enable_stack_trace("${name}")
  
  monero_set_target_no_relink("${name}")
  monero_set_target_strip    ("${name}")
endfunction ()

function (enable_stack_trace target)
  if(STACK_TRACE)
    set_property(TARGET ${target}
      APPEND PROPERTY COMPILE_DEFINITIONS "STACK_TRACE")
    if (STATIC)
      set_property(TARGET "${target}"
        APPEND PROPERTY LINK_FLAGS "-Wl,--wrap=__cxa_throw")
    endif()
  endif()
endfunction()
