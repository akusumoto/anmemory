# 機密音声保管サイト 設計書

## Phase 4 実装注記

- RIFF/WAVE の PCM 整数（8 / 16 / 24 / 32 bit）および IEEE Float（32 bit）を入力として扱う。
- チャンネル数は mono / stereo に限定し、mono 入力は左右同一の stereo に変換する。
- WAV のチャンク情報は必要な範囲だけ `Blob.slice()` で読み、PCM は 16,384 frame 単位でデコードして `AudioEncoder` へ渡す。元 WAV 全体は一括してメモリへ読み込まない。
- AAC 設定は `codec: "mp4a.40.2"`、96 kbps、2 channel、`aac.format: "aac"` とする。
- `AudioEncoder` が返す raw AAC access unit と AudioSpecificConfig を ISO BMFF の M4A コンテナへ格納する。
- 生成後に 50 MiB 上限を検査する。Phase 4 単体では生成 Blob をブラウザ内に保持し、サーバーへの送信は行わない。

## Phase 5 実装注記

- WAV内部の日付は BWF `bext` の OriginationDate と RIFF `LIST/INFO` の `ICRD` を対象とし、両方がある場合は `bext` を優先する。
- 録音日は内部メタデータ、`rec_YYYYMMDD_N.wav` 形式のファイル名、ファイル選択日時の順で決定し、存在しない日付は採用しない。
- ファイル名が想定形式に一致した場合は `N` を `sequence` として保持する。録音日が内部メタデータ由来でも連番はファイル名から取得する。
- `durationSec` はWAVのframe数とsample rateから算出して整数秒へ丸める。
- タグはカンマ、読点、改行で分割し、空要素と重複を除去する。メモは自由入力とする。
- `uploadedAt` はファイル選択時刻のISO 8601文字列として保持する。Phase 5 単体ではメタデータをサーバーへ送信しない。

## 1. 目的

個人用途で、機密性のある音声ファイルを安全にアップロード・保管・再生できるWebサイトを構築する。

実装はシンプルさを優先し、ユーザー管理DBや外部認証基盤は使用しない。
利用者は1人のみを想定し、マスターパスワードによる認証を行う。

主な要件:

- スマートフォンから利用する
- WAVファイルをアップロードできる
- アップロード前にブラウザ側で AAC / M4A に変換する
- R2に保存する音声ファイルは暗号化する
- メタデータも暗号化する
- マスターパスワードによる単一ユーザー認証
- セッション有効期限は1時間
- ログイン試行回数制限を行う
- DBは使用しない

---

## 2. 技術スタック

### フロントエンド

- React
- TypeScript
- Vite
- WebCodecs API
- HTML5 Audio

### バックエンド

- Cloudflare Workers
- TypeScript
- Web Crypto API

### ホスティング

- Cloudflare Workers Static Assets

フロントエンドとAPIを1つのWorkerプロジェクトとしてデプロイする。

### ストレージ

- Cloudflare R2
- Private Bucket
- Public Accessは禁止する

### データベース

使用しない。

以下も第一版では使用しない。

- D1
- KV
- Durable Objects
- Cloudflare Access
- Cloudflare Pages

---

## 3. システム構成

```text
スマートフォン
    |
    | HTTPS
    v
Cloudflare Worker
    |
    +-- Static Assets
    |     +-- Login UI
    |     +-- Audio List UI
    |     +-- Upload UI
    |
    +-- Authentication API
    |
    +-- Audio API
    |
    +-- Encryption / Decryption
    |
    v
Private Cloudflare R2
```

すべてのアクセスはCloudflare Workerを経由する。

R2にはブラウザから直接アクセスさせない。

---

## 4. 認証

### 4.1 ユーザー

ユーザーは1人のみ。

ユーザー名・メールアドレスは使用せず、マスターパスワードのみで認証する。

### 4.2 パスワード保存

マスターパスワードそのものは保存しない。

Cloudflare Workers Secretsにパスワード検証用の値を保存する。

例:

```text
MASTER_PASSWORD_VERIFIER
SESSION_SECRET
ENCRYPTION_KEY
```

パスワード検証には以下を使用する。

```text
PBKDF2-HMAC-SHA-256
```

saltを使用する。

### 4.3 パスワード強度

強いパスワードを必須にはしない。

ただし、暗号化鍵はマスターパスワードから生成しない。

ログイン用パスワードとファイル暗号化鍵は完全に分離する。

---

## 5. ログイン試行回数制限

`POST /api/login` に対してRate Limitを設定する。

第一版の基本設定:

```text
同一IP
5回 / 60秒
```

パスワード認証に失敗した場合のみカウントすることを基本とする。

制限を超えた場合:

```http
HTTP 429 Too Many Requests
```

を返す。

---

## 6. セッション

ログイン成功時にCookieを発行する。

セッション有効期限:

```text
1時間
```

Cookie属性:

```text
HttpOnly
Secure
SameSite=Strict
Path=/
Max-Age=3600
```

Cookieには以下を保存しない。

- マスターパスワード
- 暗号化鍵
- File Key

セッションはHMAC-SHA-256署名付きのステートレスCookieとする。

例:

```json
{
  "exp": 1234567890
}
```

このpayloadに `SESSION_SECRET` を使って署名する。

セッションDBは使用しない。

---

## 7. 音声アップロード

### 7.1 対応端末

比較的新しいスマートフォンを対象とする。

WebCodecs APIが使用できるブラウザを前提とする。

アプリ起動時、またはアップロード画面表示時に以下を確認する。

```javascript
AudioEncoder.isConfigSupported(...)
```

非対応の場合はアップロード不可であることを画面に表示する。

---

## 8. 入力音声

第一版の主な入力形式:

```text
WAV
```

想定ファイル名:

```text
rec_YYYYMMDD_N.wav
```

例:

```text
rec_20260911_1.wav
rec_20260911_2.wav
rec_20260912_1.wav
```

`N` は同一日の録音順を示す整数として扱う。

---

## 9. 音声変換

WAVをCloudflareへ送信する前に、スマートフォンのブラウザ内で変換する。

処理:

```text
WAV
 |
 v
PCM読み込み
 |
 v
WebCodecs AudioEncoder
 |
 v
AAC-LC
 |
 v
M4A container
```

変換仕様:

```text
Codec: AAC-LC
Bitrate: 96 kbps
Channels: Stereo
Container: M4A
```

元WAVが100MBを超える場合でも、変換後のM4Aのみサーバーへアップロードする。

元WAVはサーバーへ送信しない。

---

## 10. ファイルサイズ制限

Workerへアップロードする変換後ファイルは、

```text
最大50MB
```

とする。

96kbpsの場合の目安:

```text
30分  約22MB
60分  約43MB
70分  約50MB
```

50MBを超えた場合はアップロードを行わず、ユーザーへエラー表示する。

第一版では自動的なビットレート低下やファイル分割は行わない。

---

## 11. スマートフォン向けメモリ設計

巨大なWAVを一括してメモリへ読み込まない。

可能な限り以下のように処理する。

```text
WAV
 |
 +-- chunk
 |    |
 |    v
 |  PCM
 |    |
 |    v
 |  AudioEncoder
 |    |
 |    v
 |  AAC chunk
 |
 +-- 次のchunk
```

変換完了後は、元WAVのBlob / ArrayBuffer / Object URLなどへの参照を速やかに解放する。

---

## 12. 暗号化

### 12.1 基本方式

音声ファイルはR2保存前に暗号化する。

暗号方式:

```text
AES-256-GCM
```

暗号化と同時に改ざん検出も行う。

### 12.2 鍵分離

ログイン用マスターパスワードから暗号化鍵を生成しない。

Workers Secretsにランダム生成した256bitのマスター暗号化鍵を保存する。

```text
ENCRYPTION_KEY
```

---

## 13. Envelope Encryption

各音声ファイルごとにランダムなFile Keyを生成する。

```text
Master Encryption Key
       |
       +-- File Key A -> Audio A
       +-- File Key B -> Audio B
       +-- File Key C -> Audio C
```

### アップロード時

```text
1. 256bitランダムFile Key生成
2. ランダムIV生成
3. File KeyでM4AをAES-256-GCM暗号化
4. ENCRYPTION_KEYでFile Keyを暗号化
5. 暗号化音声をR2へ保存
6. 暗号化File Keyと必要情報を保存
```

File Keyを平文で保存しない。

音声、メタデータ、File Keyの暗号化ではそれぞれ別の96bit IVを生成し、用途を示すAdditional Authenticated Dataを付与する。IVは再利用しない。

---

## 14. R2 Object Key

元ファイル名はR2 Object Keyに使用しない。

UUID等のランダムなIDを使用する。

例:

```text
audio/01994a28-cb82-7f31-xxxx-xxxxxxxxxxxx.bin
```

これによりR2上のファイル名から内容や録音日を推測できないようにする。

---

## 15. メタデータ

各音声ファイルについて以下を保持する。

```text
fileName
recordedDate
recordedDateSource
durationSec
sequence
tags
memo
uploadedAt
```

### 各項目

#### fileName

アップロード元のファイル名。

例:

```text
rec_20260911_1.wav
```

変換後がM4Aであっても、表示用の元ファイル名として保持する。

#### recordedDate

録音日。

形式:

```text
YYYY-MM-DD
```

時間は保持しない。

例:

```text
2026-09-11
```

#### recordedDateSource

録音日をどこから取得したか。

値:

```text
metadata
filename
upload
```

#### durationSec

音声長を秒数で保持する。

例:

```text
3724
```

#### sequence

ファイル名の `N`。

例:

```text
rec_20260911_3.wav
```

の場合:

```text
sequence = 3
```

ファイル名から取得できない場合は `null` とする。

#### tags

文字列配列。

例:

```json
[
  "仕事",
  "会議"
]
```

#### memo

自由記述。

例:

```text
○○案件についての打ち合わせ
```

#### uploadedAt

内部管理用のアップロード日時。

ISO 8601形式で保持する。

録音日の判定以外では通常UIへ表示する必要はない。

---

## 16. 録音日の取得ルール

録音日は以下の優先順位で決定する。

### 第一候補

ファイル内メタデータ。

録音日が取得できる場合:

```text
recordedDateSource = metadata
```

日時情報が存在しても、日付部分のみ使用する。

### 第二候補

ファイル名。

想定形式:

```text
rec_YYYYMMDD_N.wav
```

正規表現例:

```regex
^rec_(\d{4})(\d{2})(\d{2})_(\d+)\.wav$
```

例:

```text
rec_20260911_3.wav
```

から:

```json
{
  "recordedDate": "2026-09-11",
  "recordedDateSource": "filename",
  "sequence": 3
}
```

を生成する。

### 第三候補

アップロード日。

```text
recordedDateSource = upload
```

`uploadedAt` の日付部分を使用する。

---

## 17. メタデータ暗号化

メタデータも機密情報として扱う。

以下の情報をR2に平文保存しない。

- 元ファイル名
- 録音日
- タグ
- メモ
- 長さ
- sequence

メタデータ全体をJSON化してAES-256-GCMで暗号化する。

復号後JSON例:

```json
{
  "fileName": "rec_20260911_3.wav",
  "recordedDate": "2026-09-11",
  "recordedDateSource": "filename",
  "durationSec": 3724,
  "sequence": 3,
  "tags": ["仕事", "会議"],
  "memo": "○○案件について",
  "uploadedAt": "2026-09-11T12:00:00Z"
}
```

R2には暗号化済みのblobのみを保存する。

---

## 18. R2保存構造

例:

```text
audio/
  01994a28-cb82-7f31-xxxx.bin
  01994b71-b104-7a22-xxxx.bin
  01994c33-c905-7b21-xxxx.bin
```

各Objectには暗号化処理に必要な最低限の非機密情報のみを付与する。

例:

```text
version
audioIv
wrappedKey
wrappedKeyIv
metadataIv
```

第一版では、暗号化メタデータと音声暗号文を次の独自バイナリフォーマットで同一Objectへ保存する。

```text
ANMEM001                    8-byte magic
headerLength                4-byte unsigned integer, big endian
header                      UTF-8 JSON（非機密情報のみ）
encryptedMetadata           AES-256-GCM ciphertext + authentication tag
encryptedAudio              AES-256-GCM ciphertext + authentication tag
```

headerには `version`、`algorithm`、各IV、暗号化済みFile Key、各暗号文長だけを格納する。元ファイル名・録音日・タグ・メモなどは格納しない。

---

## 19. API

第一版では以下のAPIを用意する。

### POST /api/login

マスターパスワード認証。

成功:

```http
200 OK
Set-Cookie: session=...
```

失敗:

```http
401 Unauthorized
```

Rate Limit超過:

```http
429 Too Many Requests
```

---

### POST /api/logout

セッションCookieを削除する。

---

### POST /api/storage-check

認証済みユーザーがPrivate R2との接続を確認するための管理用API。

ランダムな非機密データを `system/storage-check/` 配下へ一時保存し、取得内容を検証してから必ず削除する。音声やメタデータは使用しない。

処理:

```text
1. Session確認
2. ランダムなテストデータをR2へ保存
3. R2から取得して内容を検証
4. テストObjectを削除
5. 削除済みであることを確認
```

R2接続に失敗した場合:

```http
503 Service Unavailable
```

---

### POST /api/encryption-check

認証済みユーザーが暗号化・復号経路を確認するための管理用API。

ランダムな識別文字列を含むテスト音声とメタデータをEnvelope Encryptionで暗号化し、R2への保存後も平文が含まれないことを確認する。その後、復号内容を検証してテストObjectを削除する。

暗号化・復号・改ざん検証またはR2操作に失敗した場合:

```http
503 Service Unavailable
```

レスポンスには鍵、Object Key、内部エラーを含めない。

---

### GET /api/audio

音声一覧を取得する。

処理:

```text
1. Session確認
2. R2 Object一覧取得
3. メタデータ復号
4. 一覧JSON生成
5. クライアントへ返却
```

---

### POST /api/audio

変換済みM4Aをアップロードする。

処理:

```text
1. Session確認
2. 50MB以下か確認
3. metadata受信
4. File Key生成
5. 音声暗号化
6. metadata暗号化
7. File Keyをwrap
8. R2へ保存
```

---

### GET /api/audio/:id

音声を再生・取得する。

処理:

```text
1. Session確認
2. R2から暗号文取得
3. wrapped File Key復号
4. 音声復号
5. Content-Type: audio/mp4 で返却
```

第一版では50MB以下なので、実装複雑度を抑えつつWorkerのメモリ上限に注意する。

可能であればストリーム処理を使用する。

---

### DELETE /api/audio/:id

音声を削除する。

処理:

```text
1. Session確認
2. R2 Object削除
```

---

## 20. 音声一覧UI

基本表示:

```text
2026/09/11

rec_20260911_1.wav
32:18
[仕事] [会議]

メモ...

[再生]
[削除]
```

録音日ごとにグループ化する。

標準ソート:

```text
recordedDate DESC
sequence ASC
```

sequenceがない場合はファイル名またはuploadedAtを補助ソートに使用する。

---

## 21. アップロードUI

例:

```text
[音声ファイルを選択]

rec_20260911_1.wav
WAV 183 MB

録音日:
2026/09/11
（ファイル名から取得）

タグ:
[仕事] [会議] [+追加]

メモ:
[________________________]

変換中...
63%

M4A 41.2 MB
AAC 96kbps Stereo

[アップロード]
```

アップロード前にユーザーがタグ・メモを入力できる。

---

## 22. エラー処理

最低限以下を扱う。

### 未認証

```http
401 Unauthorized
```

フロントエンドはログイン画面へ戻す。

### セッション期限切れ

1時間経過後にAPIアクセスした場合、ログイン画面へ戻す。

### Rate Limit

```http
429 Too Many Requests
```

### WebCodecs非対応

アップロード機能を無効化し、対応端末・ブラウザが必要であることを表示する。

### 変換後50MB超過

アップロードを禁止する。

### 音声変換失敗

元WAVは送信しない。

### 暗号化 / 復号失敗

データ破損または認証タグ不一致として処理し、音声を返さない。

---

## 23. セキュリティ要件

以下を必須とする。

- HTTPSのみ
- R2 Public Access無効
- Worker経由以外でR2を取得不可
- AES-256-GCM
- 音声ファイルごとのランダムFile Key
- 暗号化鍵とログインパスワードの分離
- メタデータ暗号化
- Secure Cookie
- HttpOnly Cookie
- SameSite=Strict Cookie
- セッション有効期限1時間
- ログインRate Limit
- パスワードや鍵をソースコードに記載しない
- Workers Secretsを使用
- Gitリポジトリに秘密情報をコミットしない

---

## 24. 推奨ディレクトリ構成

```text
private-audio/
├── src/
│   ├── worker/
│   │   ├── index.ts
│   │   ├── auth.ts
│   │   ├── session.ts
│   │   ├── crypto.ts
│   │   ├── r2.ts
│   │   └── routes/
│   │       ├── login.ts
│   │       ├── logout.ts
│   │       └── audio.ts
│   │
│   └── frontend/
│       ├── main.tsx
│       ├── App.tsx
│       ├── components/
│       │   ├── Login.tsx
│       │   ├── AudioList.tsx
│       │   ├── AudioItem.tsx
│       │   └── Upload.tsx
│       └── audio/
│           ├── wav.ts
│           ├── encoder.ts
│           └── m4a.ts
│
├── public/
├── wrangler.jsonc
├── vite.config.ts
├── package.json
├── tsconfig.json
└── README.md
```

---

## 25. Cloudflare設定例

概念例:

```jsonc
{
  "name": "private-audio",
  "main": "src/worker/index.ts",
  "compatibility_date": "YYYY-MM-DD",

  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "run_worker_first": true
  },

  "r2_buckets": [
    {
      "binding": "AUDIO_BUCKET",
      "bucket_name": "anmemory-audio"
    }
  ]
}
```

実際の設定項目は実装時点のWrangler仕様に合わせて調整する。

---

## 26. Secrets

必要なSecrets:

```text
MASTER_PASSWORD_VERIFIER
SESSION_SECRET
ENCRYPTION_KEY
```

これらはGit管理しない。

ローカル開発用Secretsについても `.gitignore` 対象とする。

---

## 27. 第一版で実装しないもの

以下は第一版の対象外。

- 複数ユーザー
- ユーザー登録
- メール認証
- OAuth
- Cloudflare Access
- 音声文字起こし
- 全文検索
- 自動タグ付け
- WAVのサーバー側変換
- 50MBを超えるM4A
- 自動音声分割
- ビットレート自動調整
- 古いブラウザ対応
- R2への直接アップロード
- ファイル共有機能

---

## 28. Codex向け実装方針

実装時は以下を優先すること。

1. シンプルさを優先する
2. 不要なサービス・ライブラリを増やさない
3. ブラウザ標準APIを優先する
4. Cloudflare Workers Web Crypto APIを使用する
5. R2は必ずPrivateにする
6. すべての `/api/*` で認証確認を行う
7. Static Assetsも未認証時はWorkerで制御する
8. 秘密情報をコード・ログへ出力しない
9. 音声とメタデータをR2へ平文保存しない
10. スマートフォンでのメモリ使用量を意識する
11. WAV全体を不用意にArrayBuffer化しない
12. 変換後ファイルは50MBを超えないことを検証する
13. 暗号化処理にはAES-GCMを使用し、IVを再利用しない
14. cryptographic randomには `crypto.getRandomValues()` を使用する
15. エラー時に秘密情報・鍵・内部構造をレスポンスへ含めない

---

## 29. 完成条件

第一版は以下を満たした時点で完成とする。

- スマートフォンからサイトへアクセスできる
- マスターパスワードでログインできる
- 誤ったパスワードの連続試行が制限される
- セッションが1時間で失効する
- WAVを選択できる
- WAVからAAC-LC 96kbps StereoのM4Aへ変換できる
- 変換後50MB以下のみアップロードできる
- `rec_YYYYMMDD_N.wav` から録音日とsequenceを取得できる
- タグとメモを設定できる
- R2へ暗号化して保存できる
- メタデータも暗号化されている
- 音声一覧を表示できる
- 録音日・sequence順に並べられる
- 音声を復号して再生できる
- 音声を削除できる
- R2を直接参照しても音声・ファイル名・タグ・メモを取得できない
