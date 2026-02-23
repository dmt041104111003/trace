# Aiken CIP-68 contracts + NestJS backend & tests

Dự án này triển khai **traceability (truy xuất nguồn gốc)** trên Cardano theo **CIP-68** bằng cách:

- **On-chain (Aiken / Plutus v3)**: 2 validator chính
  - `mint` (minting policy): kiểm soát **mint / burn / revoke** cặp tài sản CIP-68.
  - `store` (spending script): giữ **UTxO “kho dữ liệu”** chứa token **Reference (label 100)** + **inline datum** (metadata CIP-68), cho phép **update/remove** theo luật.
- **Off-chain (TypeScript / NestJS + MeshSDK)**:
  - Tạo tx mint/update/burn/revoke theo đúng ràng buộc của validators.
  - Fetch dữ liệu on-chain qua **Blockfrost** (có fetcher riêng + adapter Mesh).
  - Bộ test Jest để demo “traceability” theo luồng mint → update → burn/revoke.

---

## TL;DR kỹ thuật

- **CIP-68 labels đang dùng**
  - **Reference (label 100)** prefix: `000643b0`
  - **User token (label 222)** prefix: `000de140`
  - Được khai báo ở `src/config/config.service.ts` (hằng `CIP68_PREFIX`).
- **Đơn vị tài sản (unit)**

```
unit = <policyId(56 hex)> + <labelPrefix(8 hex)> + <assetNameHex>
```

- **Nguyên tắc 1 “lô hàng / QR”**
  - Mỗi “QR / lô” phải dùng `assetName` **duy nhất**.
  - Mint tạo **2 asset**:
    - `Ref100`: quantity = `1` (khóa dữ liệu metadata trong store UTxO)
    - `NFT222` (RFT theo CIP-68 label 222): quantity = `1` (token chuyển cho receiver/participants)

---

## Cấu trúc thư mục

- `validators/`
  - `mint.ak`: minting policy (Mint/Burn/Revoke)
  - `store.ak`: spending validator cho UTxO store (Update/Remove/Minting)
- `lib/contract/`
  - `types.ak`: định nghĩa `MintRedeemer`, `StoreRedeemer`, các key metadata quan trọng (`_pk`, `receivers_raw`)
  - `utils.ak`: các hàm kiểm tra chung (pairing 100/222, allowlist burn, kiểm tra output store, v.v.)
- `plutus.json`: output sau `aiken build` (chứa compiledCode/hash + schema)
- `src/`
  - `trace/`: **Trace API** (NestJS)
    - `trace.service.ts`: list assets theo policy, build metadata, build unsigned tx (mint/update/burn/revoke), submit signed tx
    - `trace.controller.ts`: HTTP endpoints (xem [Trace API](#trace-api-http-endpoints) bên dưới)
    - `trace.module.ts`: đăng ký TraceModule (CardanoModule)
  - `cip68/`
    - `cip68.contract.ts`: lớp off-chain chính (mint/burn/update/revoke + reference scripts)
    - `mesh.adapter.ts`: nạp `compiledCode` từ `plutus.json`, apply params, derive `storeAddress`, `policyId`
    - `utils.ts`: encode/decode datum, normalize metadata (đặc biệt `receivers_raw`)
  - `cardano/`: Blockfrost provider + fetcher (paginate assets/utxos/txs/datum)
  - `config/`: đọc `.env`, network, CIP68 prefixes, validator titles
- `test/`
  - `traceability.test.ts`: scenario test (mint/update/burn/revoke) — mặc định đang “return” để skip
  - `trace.test.ts`: liệt kê assets theo policy, map ref100/nft222 theo `assetName`

---

## Kiến trúc tổng thể (on-chain / off-chain)

### On-chain data model (UTxO + datum)

- **Store UTxO** (địa chỉ script `store`):
  - Chứa đúng **1 asset non-lovelace**: token **Reference (label 100)** quantity 1.
  - Inline datum là **CIP68 metadatum** (map key/value) gồm các field traceability.
- **User token (label 222)**:
  - Mint ra để phân phối/luân chuyển theo chuỗi cung ứng.
  - Dùng làm “quyền” để chứng minh đang tham gia chuỗi (off-chain có thể kiểm tra phân phối).

### Off-chain orchestration

Lớp `Cip68Contract` tạo tx bằng MeshSDK:

- `mint()`:
  - Mint **Ref100 + NFT222**.
  - Output 1 UTxO về `storeAddress` chứa Ref100 + inline datum.
  - Output NFT222 về receiver (mặc định là ví mint nếu không truyền `receiver`).
- `update()`:
  - Spend store UTxO (Ref100) với redeemer `Update`.
  - Re-lock lại store UTxO với **cùng Ref100** nhưng datum mới.
- `burn()`:
  - Burn **NFT222** quantity -1.
  - Có nhánh logic để validate “ai được burn” dựa trên metadata allowlist.
- `revoke()`:
  - Spend store UTxO với redeemer `Remove` (hoặc `Minting` tùy cách gọi), đồng thời burn **Ref100** (thu hồi dữ liệu).

---

## Logic hợp đồng (chi tiết)

Các luật dưới đây là “xương sống” của dự án. Khi viết thêm tính năng, ưu tiên không phá các invariant này.

### 1) Minting policy `validators/mint.ak`

Validator `mint` có 3 tham số (được apply off-chain ở `src/cip68/mesh.adapter.ts`):

- `store_payment_credential: ScriptHash` (hash script `store`)
- `store_stake_credential: VerificationKeyHash` (stake credential hash gắn với store address)
- `issuer: VerificationKeyHash` (pubKeyHash của ví “minter/issuer”)

Redeemer (định nghĩa ở `lib/contract/types.ak`):

- `Mint`
- `Burn`
- `Revoke`

#### Mint redeemer

Luật chính (tóm theo `mint.ak` + `utils.ak`):

- Phải mint theo **cặp**: mỗi assetName có **Ref100 (prefix 100)** và **NFT222 (prefix 222)**.
- `Ref100` quantity = 1, `NFT222` quantity = 1.
- Phải tạo output về **store address** chứa Ref100 và inline datum hợp lệ.
- Datum phải chứa `_pk` (author/issuer) và chữ ký author phải có trong `extra_signatories`.

Off-chain enforce thêm:

- `Cip68Contract.mint()` bắt buộc `quantity === "1"` cho label 222.
- Chặn mint trùng `assetName` bằng cách query UTxO ở `storeAddress` xem đã có Ref100 unit chưa.

#### Burn redeemer

Có 2 “mode” burn trong Aiken:

- **Burn có reference asset trong inputs**: `utils.find_input_reference_asset(...)` tìm thấy Ref100 trong inputs, thì cho phép check burn theo `utils.check_asset_burn(...)`.
- **Burn không có reference asset trong inputs**: validator cố lấy metadatum của Ref100 từ `reference_inputs` sao cho suffix assetName khớp NFT222 đang burn. Khi tìm thấy datum:
  - Lấy `author` từ key `_pk`
  - Lấy allowlist receivers từ key `receivers_raw`
  - Chỉ cho phép burn nếu `extra_signatories` chứa **author** hoặc **một receiver** (`utils.burner_in_allowlist`).
  - Đồng thời bắt buộc burn đúng prefix 222 và đúng amount.

Off-chain `Cip68Contract.burn()` bổ sung guard:

- Parse datum của store UTxO: wallet burn phải là **minter** hoặc thuộc `receivers` (đọc qua `decodeReceivers` / `_pk`).
- Có nhánh `minterMintScriptCbor`: trường hợp người burn không có mint script gốc (vì policyId có thể khác), họ cần CBOR script của minter để builder attach đúng script.

#### Revoke redeemer

Luật revoke:

- Phải có “reference asset” trong inputs (tức có liên quan đến store/ref100).
- Chỉ cho phép **burn Ref100** và **không được mint/burn NFT222** trong cùng hành động (`utils.check_asset_revoke`).

Mục tiêu: thu hồi dữ liệu (Ref100) về mặt on-chain, khiến asset bị “revoked” khi truy vết.

---

### 2) Store validator `validators/store.ak`

Validator `store` có 1 tham số:

- `issuer: VerificationKeyHash`

Luật nền:

- Mọi hành động spend store UTxO đều yêu cầu **ký bởi author** lấy từ datum key `_pk`.
- Dữ liệu store UTxO luôn gắn với “reference token” (Ref100) đang giữ.

Redeemer:

- `Update`
  - Output phải trả lại đúng “reference_token” về đúng `script_address`.
  - Output datum mới phải có **cùng author** như datum cũ (không cho đổi `_pk`).
  - `utils.check_output_update(...)`: số UTxO store outputs phải bằng số store inputs (ngăn “gộp/tách” bất thường).
  - `utils.check_output_utxo(...)`: output store phải có đúng 1 asset non-lovelace và author == issuer và có chữ ký author.
- `Remove`
  - Phải có output trả về `author_address` (một dạng “dấu vết”/hoàn trả) theo `utils.check_output_remove`.
- `Minting`
  - Gần giống Update nhưng nhẹ hơn: bắt buộc output store hợp lệ + author không đổi.

---

## Off-chain: các điểm “đáng chú ý”

### `src/cip68/mesh.adapter.ts` (khởi tạo scripts + địa chỉ)

Luồng init:

- Đọc `compiledCode` của validators từ `plutus.json` theo `VALIDATOR_TITLE`:
  - `mint: "mint.mint.mint"`
  - `store: "store.store.spend"`
- Derive `pubKeyIssuer` và `stakeCredentialHash` từ `wallet.getChangeAddress()`.
- Apply params:
  - `storeScriptCbor = applyParamsToScript(storeCode, [pubKeyIssuer])`
  - Derive `storeAddress` từ `storeScriptHash` + stake credential.
  - `mintScriptCbor = applyParamsToScript(mintCode, [storeScriptHash, stakeCredentialHash, pubKeyIssuer])`
  - Derive `policyId = resolveScriptHash(mintScriptCbor, "V3")`

Hệ quả kiến trúc:

- PolicyId phụ thuộc vào ví issuer (tham số), nên **mỗi issuer có thể tạo một policy riêng** theo cùng code.

### `src/cip68/utils.ts` (metadata/datum)

Các key quan trọng:

- `_pk`: author pubKeyHash (on-chain dùng để check signature)
- `receivers`: off-chain format `pk1,pk2,pk3,...` (dễ đọc, dùng trong test)
- `receivers_raw`: on-chain parse dạng “hex của chuỗi nối pk”, để Aiken slice theo 28 bytes/PKH

Quy tắc encode:

- `ensureReceiversRaw()` tạo `receivers_raw` từ `receivers` bằng cách **nối** các `pubKeyHash`.
- `metadataForDatum()` chuyển `receivers_raw` sang **utf8→hex** trước khi đưa vào CIP-68 datum.

---

## Trace API (HTTP endpoints)


### Endpoints

| Method | Path | Mô tả |
|--------|------|--------|
| GET | `/trace/policy/:policyId` | Liệt kê assets theo policy (ref100 + nft222 theo `assetName`) |
| POST | `/trace/metadata/build` | Build object metadata CIP-68 từ body (name, image bắt buộc; properties tùy chọn) |
| POST | `/trace/mint` | Build **unsigned tx** mint (Ref100 + NFT222). Body: `changeAddress`, `assetName`, `metadata`, `receiver?` |
| POST | `/trace/update` | Build **unsigned tx** update store datum. Body: `changeAddress`, `assetName`, `metadata`, `txHash?` |
| POST | `/trace/burn` | Build **unsigned tx** burn NFT222. Body: `changeAddress`, `assetName`, `quantity?`, `txHash?` |
| POST | `/trace/revoke` | Build **unsigned tx** revoke Ref100. Body: `changeAddress`, `assetName`, `txHash?` |
| POST | `/trace/submit` | **Submit** signed tx lên chain. Body: `signedTx` (hex CBOR đã ký). Trả về `txHash`. |

### Luồng dùng API (không mnemonic trên server)

1. Client lấy địa chỉ ví (change address) và chuẩn bị `assetName`, `metadata`.
2. Gọi **POST /trace/mint** (hoặc update/burn/revoke) với `changeAddress` + tham số tương ứng.
3. Server trả về `{ unsignedTx: string }` (hex CBOR).
4. Client **ký** `unsignedTx` bằng ví (Nami, Eternl, hoặc backend có key riêng).
5. Gửi **POST /trace/submit** với `{ signedTx: "<hex đã ký>" }` → server submit qua Blockfrost và trả `{ txHash: string }`.

**Lưu ý**: Server dùng **read-only wallet** (chỉ `changeAddress` + fetch UTxOs từ Blockfrost) để build tx; không lưu và không đọc mnemonic.

### Chạy server API

```bash
npm run start        # production
npm run start:dev    # development (watch)
```


---

## Cách build / check / test

### Prerequisites

- Node.js (khuyến nghị >= 18)
- Aiken (compiler, phù hợp Plutus v3)
- Blockfrost API key (để fetch UTxO/asset/tx trong tests)

### Cài dependencies

```bash
npm install
```

### Build/check contracts (Aiken)

```bash
npm run check
npm run build
```

Output quan trọng:

- `plutus.json` (compiled validators + schemas)

### Chạy tests (Jest)

```bash
npm test
```

Ghi chú:

- `test/traceability.test.ts` hiện có nhiều `return;` trong từng `describe(...)` để **skip** các test có side-effect (submit tx). Muốn chạy thật thì xóa các `return;` đó.

---

## Cấu hình môi trường (.env)

**Cho API (NestJS):**

- `BLOCKFROST_API_KEY`: dạng `preprod...` hoặc `mainnet...` (bắt buộc cho Trace API)
- `NEXT_PUBLIC_APP_NETWORK`: `preprod` hoặc `mainnet` (mặc định `preprod`)

API **không đọc** `APP_MNEMONIC`; client gửi `changeAddress` và tự ký tx.

**Cho test submit tx (mint/update/burn/revoke) trong Jest:**

- `APP_MNEMONIC`: mnemonic ví issuer (>= 15 từ)
- `TRACE_ASSET_NAME`: base assetName (mặc định `C2VN`)
- (tuỳ chọn) `E_MNEMONIC`: mnemonic ví receiver (để test burn “trong chuỗi”)
- (tuỳ chọn) `REF_SCRIPT_ADDRESS`: địa chỉ để tạo reference script UTxO

**Cảnh báo**: không commit mnemonic vào repo.

---

## Luồng nghiệp vụ traceability (đề xuất)

### 1) Mint “lô hàng / QR”

Input off-chain:

- `assetName`: mã định danh duy nhất (gợi ý: `${base}-${timestamp}-${rand}`)
- `metadata`: các field traceability (tự do) + bắt buộc `_pk`, `receivers`
- `receiver`: địa chỉ nhận NFT222 (thường là minter hoặc mắt xích đầu)

**Qua Trace API**: POST `/trace/mint` với `changeAddress`, `assetName`, `metadata`, `receiver?` → nhận `unsignedTx` → client ký → POST `/trace/submit` với `signedTx`.

Output on-chain:

- Store UTxO: `Ref100` + inline datum metadata (CIP-68)
- Receiver UTxO: `NFT222`

### 2) Update trạng thái / mở rộng chuỗi

- Minter/author ký và update datum ở store UTxO.
- Thay đổi `receivers` → đồng bộ sang `receivers_raw` (để burn allowlist hoạt động).
- **Qua API**: POST `/trace/update` với `changeAddress`, `assetName`, `metadata`, `txHash?` → `unsignedTx` → ký → `/trace/submit`.

### 3) Burn (tiêu thụ/huỷ theo chuỗi)

Chỉ cho phép nếu:

- Người burn là **author** hoặc nằm trong allowlist **receivers** đã ghi trong datum.
- **Qua API**: POST `/trace/burn` → `unsignedTx` → ký → `/trace/submit`.

### 4) Revoke (thu hồi dữ liệu)

- Issuer/author thu hồi Ref100 (dữ liệu) bằng hành động burn Ref100 theo luật `Revoke`.
- **Qua API**: POST `/trace/revoke` → `unsignedTx` → ký → `/trace/submit`.
- Khi revoke xong, truy vấn Ref100 quantity có thể về `0` (tuỳ cách indexer trả về).

---

