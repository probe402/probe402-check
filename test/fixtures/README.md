# Recorded answers

Every file here is a real response, recorded from a public address and kept byte for byte. None is
hand-built: the tests run the code on what the surface actually served.

| File | Recorded from | When (UTC) |
|---|---|---|
| `grade-ep_67bec7d9e13ef185.json` | `https://probe402.com/grade/ep_67bec7d9e13ef185` (datastand.dev GET /api/data/dev-signals; on the paid panel) | 2026-09-17 ~11:56 |
| `grade-ep_addf52df476011b1.json` | `https://probe402.com/grade/ep_addf52df476011b1` (api.myceliasignal.com GET /oracle/econ/calendar/fomc; on the paid panel) | 2026-09-17 ~11:56 |
| `grade-ep_e68279cac4e97ffb.json` | `https://probe402.com/grade/ep_e68279cac4e97ffb` (api.myceliasignal.com GET /oracle/price/btc/usd; on the list, not on the panel) | 2026-09-17 ~11:56 |
| `grade-host-api.myceliasignal.com.json` | `https://probe402.com/grade?url=https://api.myceliasignal.com` (a host: 112 routes) | 2026-09-17 ~11:56 |
| `grade-not-covered.json` | `https://probe402.com/grade?url=https://example.com/nothing-here` (an address probe402 does not hold) | 2026-09-17 ~12:05 |
| `chain-2026-08-21.json` | `https://probe402.com/chain/2026-08-21` (the archive's day 0 manifest, 109,954 bytes) | 2026-09-17 ~11:58 |
| `chain-2026-08-22.json` | `https://probe402.com/chain/2026-08-22` (day 1, which names day 0's head) | 2026-09-17 ~12:10 |
| `ARCHIVE-CHAIN-2026-09-17.md` | `https://raw.githubusercontent.com/probe402/probe402-chain-heads/main/ARCHIVE-CHAIN.md` (25 rows through 2026-09-14) | 2026-09-17 ~11:58 |

To re-record one, fetch the address again and replace the file whole. A test that fails after a
re-record is telling you the surface changed shape, which is worth knowing.
