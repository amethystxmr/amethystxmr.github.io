#include <stdio.h>
#include <emscripten.h>
#include <emscripten/bind.h>
#include <algorithm>
#include <sodium/core.h>
#include <sodium/utils.h>
#include <sodium/randombytes.h>
#include <polyseed.h>

#include <string.h>

#include <sodium/crypto_auth_hmacsha256.h>
#include <sodium/utils.h>
#include "memwipe.h"

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

EM_JS(void, normalize_utf8_js, (const char *str, const char *form, char *norm, size_t norm_str_size), {
    const input = UTF8ToString(str);
    const normalizeForm = UTF8ToString(form);
    let output = input;
    try
    {
        output = input.normalize(normalizeForm);
    }
    catch (e)
    {
        output = input;
    }
    stringToUTF8(output, norm, norm_str_size);
});

static std::string normalize_utf8(const char *str, const char *form)
{
    polyseed_str norm;
    normalize_utf8_js(str, form, norm, POLYSEED_STR_SIZE);
    return std::string(norm);
}

static size_t utf8_nfc(const char *str, polyseed_str norm)
{
    auto s = normalize_utf8(str, "NFC");
    size_t size = std::min(s.size(), (size_t)POLYSEED_STR_SIZE - 1);
    s.copy(norm, size);
    norm[size] = '\0';
    if (!s.empty())
    {
        sodium_memzero(&s[0], s.size());
    }
    return size;
}

static size_t utf8_nfkd(const char *str, polyseed_str norm)
{
    auto s = normalize_utf8(str, "NFKD");
    // polyseed expects the normalized separator to be ASCII space.
    // Ensure U+3000 IDEOGRAPHIC SPACE is mapped to ' '.
    for (size_t i = 0; i + 2 < s.size();)
    {
        if ((unsigned char)s[i] == 0xE3 &&
            (unsigned char)s[i + 1] == 0x80 &&
            (unsigned char)s[i + 2] == 0x80)
        {
            s.replace(i, 3, " ");
            ++i;
            continue;
        }
        ++i;
    }
    size_t size = std::min(s.size(), (size_t)POLYSEED_STR_SIZE - 1);
    s.copy(norm, size);
    norm[size] = '\0';
    if (!s.empty())
    {
        sodium_memzero(&s[0], s.size());
    }
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

static const char *polyseedStatusToHumanText(polyseed_status status)
{
    switch (status)
    {
    case POLYSEED_OK:
        return "Success";
    case POLYSEED_ERR_NUM_WORDS:
        return "Wrong number of words in the phrase";
    case POLYSEED_ERR_LANG:
        return "Unknown language or unsupported words";
    case POLYSEED_ERR_CHECKSUM:
        return "Checksum mismatch";
    case POLYSEED_ERR_UNSUPPORTED:
        return "Unsupported seed features";
    case POLYSEED_ERR_FORMAT:
        return "Invalid seed format";
    case POLYSEED_ERR_MEMORY:
        return "Memory allocation failure";
    case POLYSEED_ERR_MULT_LANG:
        return "Phrase matches more than one language";
    default:
        return "Unknown polyseed error";
    }
}

emscripten::val decodePolyseed(std::string moneroPolyseed)
{
    polyseed_data *seed2;
    const polyseed_lang *lang;
    auto result = polyseed_decode(moneroPolyseed.c_str(), POLYSEED_MONERO, &lang, &seed2);
    if (result != POLYSEED_OK)
    {
        throw std::runtime_error(std::string(polyseedStatusToHumanText(result)));
    }
    auto langStr = polyseed_get_lang_name_en(lang);
    // printf("Language: %s\n", langStr);
    if (polyseed_is_encrypted(seed2))
    {
        polyseed_free(seed2);
        throw std::runtime_error("Seed is encrypted, not supported");
    };
    uint8_t key2[32];
    polyseed_keygen(seed2, POLYSEED_MONERO, sizeof(key2), key2);
    // printf("Private key: ");
    // for (unsigned i = 0; i < sizeof(key2); ++i)
    // printf("%02x", key2[i] & 0xff);
    // printf("\n");

    auto birthday = polyseed_get_birthday(seed2);
    // printf("Birthday: %u\n", birthday);

    auto privateKey = emscripten::val::global("Uint8Array").new_(32);
    for (size_t i = 0; i < sizeof(key2); ++i)
    {
        privateKey.set(i, key2[i]);
    }

    emscripten::val out = emscripten::val::object();
    out.set("birthday", emscripten::val(birthday));
    out.set("privateKey", privateKey);
    out.set("langStr", emscripten::val(langStr));

    memwipe(key2, sizeof(key2));
    polyseed_free(seed2);
    return out;
}

EMSCRIPTEN_BINDINGS(monero_wasm_wallet_polyseed)
{
    emscripten::function(
        "decodePolyseed", &decodePolyseed);
}
