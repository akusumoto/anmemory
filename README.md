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

この段階では認証・R2・暗号化はまだ実装しない。

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
[ ] private_audio_design.md が配置されている
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

ここまで完了したら、`private_audio_design.md` をCodexに読ませ、Phase 1の認証実装から開始する。
