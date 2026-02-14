#include <stdio.h>
#include <emscripten.h>
#include <emscripten/bind.h>
#include "emscripten/proxying.h"
#include <sodium/core.h>
#include <sodium/utils.h>
#include <sodium/randombytes.h>
#include <boost/locale.hpp>
#include <polyseed.h>

#include <string.h>

#include <sodium/crypto_auth_hmacsha256.h>
#include <sodium/utils.h>

static inline void
store32_be(uint8_t dst[4], uint32_t w)
{
    dst[3] = (uint8_t)w;
    w >>= 8;
    dst[2] = (uint8_t)w;
    w >>= 8;
    dst[1] = (uint8_t)w;
    w >>= 8;
    dst[0] = (uint8_t)w;
}

void crypto_pbkdf2_sha256(const uint8_t *passwd, size_t passwdlen,
                          const uint8_t *salt, size_t saltlen, uint64_t c,
                          uint8_t *buf, size_t dkLen)
{
    crypto_auth_hmacsha256_state Phctx, PShctx, hctx;
    size_t i;
    uint8_t ivec[4];
    uint8_t U[32];
    uint8_t T[32];
    uint64_t j;
    int k;
    size_t clen;

    crypto_auth_hmacsha256_init(&Phctx, passwd, passwdlen);
    PShctx = Phctx;
    crypto_auth_hmacsha256_update(&PShctx, salt, saltlen);

    for (i = 0; i * 32 < dkLen; i++)
    {
        store32_be(ivec, (uint32_t)(i + 1));
        hctx = PShctx;
        crypto_auth_hmacsha256_update(&hctx, ivec, 4);
        crypto_auth_hmacsha256_final(&hctx, U);

        memcpy(T, U, 32);
        for (j = 2; j <= c; j++)
        {
            hctx = Phctx;
            crypto_auth_hmacsha256_update(&hctx, U, 32);
            crypto_auth_hmacsha256_final(&hctx, U);

            for (k = 0; k < 32; k++)
            {
                T[k] ^= U[k];
            }
        }

        clen = dkLen - i * 32;
        if (clen > 32)
        {
            clen = 32;
        }
        memcpy(&buf[i * 32], T, clen);
    }
    sodium_memzero((void *)&Phctx, sizeof Phctx);
    sodium_memzero((void *)&PShctx, sizeof PShctx);
}

static std::locale locale;

static size_t utf8_nfc(const char *str, polyseed_str norm)
{
    auto s = boost::locale::normalize(str, boost::locale::norm_type::norm_nfc, locale);
    size_t size = std::min(s.size(), (size_t)POLYSEED_STR_SIZE - 1);
    s.copy(norm, size);
    norm[size] = '\0';
    sodium_memzero(&s[0], s.size());
    return size;
}

static size_t utf8_nfkd(const char *str, polyseed_str norm)
{
    auto s = boost::locale::normalize(str, boost::locale::norm_type::norm_nfkd, locale);
    size_t size = std::min(s.size(), (size_t)POLYSEED_STR_SIZE - 1);
    s.copy(norm, size);
    norm[size] = '\0';
    sodium_memzero(&s[0], s.size());
    return size;
}

class polyseed_initializer
{
public:
    polyseed_initializer()
    {
        printf("polyseed_initializer\n");
        if (sodium_init() == -1)
        {
            throw std::runtime_error("sodium_init failed");
        }

        boost::locale::generator gen;
        gen.locale_cache_enabled(true);
        locale = gen("");

        polyseed_dependency pd;
        pd.randbytes = &randombytes_buf;
        pd.pbkdf2_sha256 = &crypto_pbkdf2_sha256;
        pd.memzero = &sodium_memzero;
        pd.u8_nfc = &utf8_nfc;
        pd.u8_nfkd = &utf8_nfkd;
        pd.time = nullptr;
        pd.alloc = nullptr;
        pd.free = nullptr;

        polyseed_inject(&pd);

        printf("Initialized\n");
    }
};

static polyseed_initializer initializer;

void keke()
{
    printf("KEKE\n");
}

EMSCRIPTEN_BINDINGS(monero_wasm_wallet_polyseed)
{
    emscripten::function(
        "keke", &keke);
}