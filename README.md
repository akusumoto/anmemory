# AnMemory

機密音声ファイルを安全に保存・再生するための個人用Webアプリケーション。

このREADMEでは、AnMemoryの開発を開始するための初期セットアップ手順をまとめる。

## 1. 前提

開発環境はWindowsを想定する。

必要なもの:

- Node.js
- npm
- Git
- Cloudflareアカウント
- Codex
- PowerShell

確認コマンド:

```powershell
node -v
npm -v
git --version
```

## 2. 作業フォルダへ移動

anmemoryを作成したい親フォルダへ移動する。

例:

```powershell
cd C:\work
```

この状態でプロジェクトを作成すると `C:\work\anmemory` が作成される。

## 3. Cloudflare Reactプロジェクトを作成

```powershell
npm create cloudflare@latest -- anmemory --framework=react
```

`anmemory` がプロジェクト名兼フォルダ名になる。

Cloudflare CLIから追加の質問が表示された場合は、React + TypeScript + Workersを使用する構成を選択する。

初期セットアップ時点では、Cloudflareへのデプロイはまだ必須ではない。

## 4. プロジェクトフォルダへ移動

```powershell
cd anmemory
```

## 5. 依存関係をインストール

テンプレート作成時に自動でインストールされていない場合:

```powershell
npm install
```

## 6. ローカル起動確認

```powershell
npm run dev
```

表示されたローカルURLをブラウザで開き、初期React画面が表示されることを確認する。

初回起動前に、後述の手順でローカル開発用Secretsを設定する。

## 7. 設計書を配置

AnMemoryの設計書 `SPEC.md` をプロジェクト直下に配置する。

```text
anmemory/
├─ SPEC.md
├─ README.md
├─ src/
├─ worker/
├─ public/
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ wrangler.jsonc
└─ .gitignore
```

## 8. Gitを初期化

テンプレート作成時にGitが初期化されていない場合:

```powershell
git init
git status
git add .
git commit -m "Initial AnMemory project"
```

## 9. .gitignore を確認

最低限、以下がGitへ入らないことを確認する。

```text
node_modules/
dist/
.dev.vars
.env
.env.*
*.local
```

特に以下はコミットしない。

```text
MASTER_PASSWORD_VERIFIER
SESSION_SECRET
ENCRYPTION_KEY
```

これらは後でCloudflare Workers Secretsとして設定する。

## 10. 推奨ディレクトリ構成

CloudflareのReactテンプレート構成を基本にしつつ、AnMemoryでは次を目安とする。

```text
anmemory/
├─ SPEC.md
├─ README.md
│
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ components/
│  │  ├─ Login.tsx
│  │  ├─ AudioList.tsx
│  │  ├─ AudioItem.tsx
│  │  └─ Upload.tsx
│  └─ audio/
│     ├─ wav.ts
│     ├─ encoder.ts
│     └─ m4a.ts
│
├─ worker/
│  ├─ index.ts
│  ├─ auth.ts
│  ├─ session.ts
│  ├─ crypto.ts
│  ├─ r2.ts
│  └─ routes/
│     ├─ login.ts
│     ├─ logout.ts
│     └─ audio.ts
│
├─ public/
├─ index.html
├─ package.json
├─ tsconfig.json
├─ vite.config.ts
├─ wrangler.jsonc
└─ .gitignore
```

Cloudflareテンプレートと競合する場合は、無理にこの構成へ変更せず、現在の公式テンプレート構成を優先する。

## 11. Codexで開発を開始する

最初の指示例:

```text
SPEC.md をAnMemoryの設計書として読み、
現在のCloudflare React + Workersプロジェクト構成を確認してください。

設計書のディレクトリ構成をそのまま強制せず、
現在のCloudflare公式テンプレートの構成を優先してください。

まだ大きな実装変更はせず、
まず現在の構成を確認し、
今後の実装計画を提示してください。
```

## 12. 実装順序

一度に全機能を実装せず、以下の順番で進める。

### Phase 1: 認証

- マスターパスワード
- PBKDF2によるパスワード検証
- セッションCookie
- 1時間の有効期限
- ログアウト
- ログイン試行回数制限

### Phase 2: R2

- Private R2 Bucket
- WorkerからR2への接続
- テストファイルの保存
- テストファイルの取得
- テストファイルの削除

この段階では暗号化なしでもよい。まずR2接続を確認する。

### Phase 3: 暗号化

- AES-256-GCM
- ファイルごとのランダムFile Key
- Envelope Encryption
- ENCRYPTION_KEY
- メタデータ暗号化
- 復号処理

### Phase 4: WAV解析と音声変換

スマートフォンブラウザ側で実装する。

入力:

```text
WAV
```

出力:

```text
M4A
AAC-LC
96kbps
Stereo
```

WebCodecs APIを使用する。

変換後ファイルサイズは最大50MB。

### Phase 5: メタデータ

保持項目:

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

録音日の優先順位:

```text
1. ファイル内メタデータ
2. ファイル名 rec_YYYYMMDD_N.wav
3. アップロード日
```

録音日は `YYYY-MM-DD` の日付のみ扱う。

### Phase 6: UI

- 音声一覧
- 日付ごとのグループ表示
- タグ
- メモ
- 再生
- 削除
- アップロード
- 変換進捗

標準ソート:

```text
recordedDate DESC
sequence ASC
```

## 13. Cloudflare設定は段階的に行う

最初からR2やSecretsをすべて設定せず、

```text
React + Worker
↓
認証
↓
R2
↓
暗号化
↓
音声変換
↓
UI
```

の順で進める。

## 14. 開発開始時の最小チェック

```text
[ ] node -v が成功する
[ ] npm -v が成功する
[ ] git --version が成功する
[ ] anmemoryフォルダが作成されている
[ ] npm install が成功する
[ ] npm run dev が成功する
[ ] React画面がブラウザで開ける
[ ] SPEC.md が配置されている
[ ] README.md が配置されている
[ ] git status が正常に動く
```

## 15. 最初に実行するコマンドまとめ

例として `C:\work` に作成する場合:

```powershell
cd C:\work

npm create cloudflare@latest -- anmemory --framework=react

cd anmemory

npm install

npm run dev
```

起動確認後、別途Gitを初期化する場合:

```powershell
git init
git add .
git commit -m "Initial AnMemory project"
```

## 16. Phase 1: 認証（実装済み）

次の機能を実装している。

- PBKDF2-HMAC-SHA-256によるマスターパスワード検証
- HMAC-SHA-256署名付きの1時間セッションCookie
- `HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/`
- ログイン、セッション確認、ログアウトAPI
- 同一IPの認証失敗を5回/60秒に制限するRate Limiting Binding
- Workerを経由したStatic Assets配信

### Secretsを生成する

対話形式の生成コマンドを実行する。入力したパスワードは画面に表示されない。

```powershell
npm run setup:secrets
```

出力された3つの値をローカルでは `.dev.vars` に保存する。

```dotenv
MASTER_PASSWORD_VERIFIER=...
SESSION_SECRET=...
ENCRYPTION_KEY=...
```

`.dev.vars` はGit管理対象外である。本番環境では値をファイルへ置かず、各値を個別に登録する。

```powershell
npx wrangler secret put MASTER_PASSWORD_VERIFIER
npx wrangler secret put SESSION_SECRET
npx wrangler secret put ENCRYPTION_KEY
```

Rate Limiting BindingはCloudflare上で動作する。ローカル開発では回数制限が強制されないため、デプロイ前後に実環境でも確認する。`wrangler.jsonc` の `namespace_id` はCloudflareアカウント内で一意にし、既に `1001` を使用している場合は別の正整数へ変更する。

### 検証コマンド

```powershell
npm test
npm run lint
npm run build
```

## 17. Phase 2: Private R2接続（実装済み）

`AUDIO_BUCKET` Bindingを通して、WorkerからR2 Objectの保存・取得・削除を行える。

接続確認ではランダムな32バイトの非機密データだけを `system/storage-check/` 配下へ一時保存する。取得内容と削除結果を検証し、音声やメタデータを平文保存しない。

### 本番バケットを作成する

Cloudflareアカウントに `anmemory-audio` がまだ存在しない場合、一度だけ作成する。

```powershell
npx wrangler r2 bucket create anmemory-audio
```

R2の設定画面で次の両方を確認する。

- Public Development URLが無効
- Custom Domainが未接続

R2バケットは明示的に公開しない限りPrivateだが、デプロイ前にも設定を確認する。

### ローカル接続を確認する

```powershell
npm run dev
```

ログイン後に「R2接続を確認」を押す。ローカル開発ではCloudflare上の本番バケットではなく、`.wrangler/state` 内のローカルR2が使用される。テストObjectは確認処理内で削除される。

### 本番接続を確認する

SecretsとPrivate R2 Bucketを準備してデプロイした後、同じボタンで本番Bindingを確認する。エラー時もObject Keyや内部エラーは画面・APIレスポンスへ返さない。

## 18. Phase 3: Envelope Encryption（実装済み）

音声とメタデータをR2へ平文保存しないため、次を実装している。

- 音声Objectごとにランダムな256bit File Keyを生成
- 音声とメタデータをFile KeyでAES-256-GCM暗号化
- `ENCRYPTION_KEY` でFile KeyをAES-256-GCMラップ
- 音声・メタデータ・File Keyごとに独立した96bit IVを生成
- 用途別Additional Authenticated Dataによる暗号文の分離
- 暗号化済みメタデータと音声を `ANMEM001` バイナリコンテナへ格納
- 認証タグ不一致、暗号文改ざん、誤ったマスター鍵を拒否

ログイン後に「暗号化を確認」を押すと、非機密のテスト音声とメタデータを暗号化してR2へ保存し、次を確認する。

```text
平文がR2 Objectに含まれない
↓
File Keyを復号できる
↓
音声とメタデータを復号できる
↓
元データと一致する
↓
テストObjectを削除できる
```

エラー時も鍵、Object Key、内部例外はAPIレスポンスへ返さない。

Cloudflare Workersのメモリ上限は128MBである。Phase 4で最大50MBの実音声アップロードを接続するときは、リクエスト本体・暗号文・R2書き込み用コピーを同時に複数保持しない設計を追加検証する。

次はPhase 4として、ブラウザ上のWAV解析とAAC-LC/M4A変換を実装する。
