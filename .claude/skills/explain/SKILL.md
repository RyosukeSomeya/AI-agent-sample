# 実装解説スキル

実装したタスクの内容を初学者向けに丁寧に解説する。

## 実行タイミング

- タスク実装完了後に `/explain TASK-XXX` で実行する
- `/implement` 完了後に自動的に案内する

## 出力先

`docs/knowledge/explanations/` ディレクトリにMarkdownファイルとして保存する。

```
docs/knowledge/explanations/TASK-XXX-explain.md
```

## 解説の構成（必須項目）

### 1. このタスクで何を作ったか（一言まとめ）

技術用語を使わず、日常の言葉で「何を作ったか」を1〜2文で説明する。

### 2. 作成・変更したファイル一覧

各ファイルについて以下を記載する:

| 項目 | 内容 |
|---|---|
| ファイル名 | パス |
| これは何か | 日常の言葉での説明（例:「買い物リストのようなもの」） |
| なぜ必要か | このファイルがないと何が困るか |
| 中身の要点 | コードの主要な部分を抜粋して解説 |
| 関連技術 | Strands Agents / AWS / 素のPython のどれに関係するか |

**さらに各ファイルの説明文中にも TS/Laravel の対応を自然に織り込む。** 表だけでなく文章の流れの中で「TSでいう○○」「Laravelでいう○○」と言及し、既存知識と結びつけてスムーズにキャッチアップできるようにする。

例:
> TSでいう **ルートの `package.json`** に `"workspaces": ["packages/*"]` と書くのと同じ役割。
> Laravelでいう **`Storage::disk('s3')->put()`** と同じ。
> `@dataclass(frozen=True)` は TSの `Readonly<T>` に近い。

コード抜粋にもインラインコメントで対応を示す:
```python
import boto3   # ← TSなら import { S3Client } from '@aws-sdk/client-s3'
               #    Laravelなら use Illuminate\Support\Facades\Storage
```

### 3. ファイル間の関係図

どのファイルがどのファイルを使っているかを図で示す。

### 4. 今回登場した技術・用語の解説

初めて登場した技術やライブラリを「それは何か」「なぜ使うか」で解説する。

### 5. ワークショップ・本番構成との対応

- AgentCoreワークショップのどのLabに関係するか
- 本番構成（architecture.drawio）のどの部分に対応するか
- 本番との違い（簡略化した部分）

### 6. 次のタスクへのつながり

今回作ったものが次のタスクでどう使われるかを説明する。

## 解説のルール

- **技術用語には必ず「それは何か」の補足を入れる**（例: Pydantic（データの形を定義するライブラリ））
- **「なぜ？」を必ず書く。** 「何を作ったか」だけでなく「なぜそう作ったか」を説明する
- **比喩を積極的に使う。** 技術概念を日常のモノに例える
- **コード抜粋は最小限。** 全コードを載せるのではなく、ポイントになる数行だけ抜粋する
- **Strands Agents / AWS / 素のPython の区別を明確にする**
- **TypeScript / PHP（Laravel）での対応物を示す。** ユーザーはTS/Laravel経験がある。Python固有の概念が出てきたら「TSでいう○○」「Laravelでいう○○」と対応を示す

## TypeScript / Laravel 対応表（頻出）

解説で Python の概念が出てきたら、以下の対応を示すこと。

| Python | TypeScript | Laravel (PHP) |
|---|---|---|
| `pyproject.toml` | `package.json` | `composer.json` |
| `uv sync` | `npm install` | `composer install` |
| `uv run python ...` | `npx ...` | `php artisan ...` |
| `.venv/` | `node_modules/` | `vendor/` |
| `uv.lock` | `package-lock.json` | `composer.lock` |
| Pydantic モデル | Zod スキーマ / TypeScript interface | Form Request / Eloquent Model の `$casts` |
| `@dataclass` | TypeScript interface | PHP readonly class / DTO |
| `@tool` デコレータ | - | - （Strands Agents 固有） |
| `boto3` | `@aws-sdk/client-s3` 等 | AWS SDK for PHP / `Storage::disk('s3')` |
| `httpx` | `fetch` / `axios` | `Http::get()` (Laravel HTTP Client) |
| `__init__.py` | `index.ts` | - （PHPには不要） |
| `__main__.py` | `bin/xxx.ts` / `scripts` in package.json | `php artisan` コマンドクラス |
| pytest | Jest / Vitest | PHPUnit |
| uvワークスペース | npm/yarn workspaces | - （Laravelはモノレポ不要が多い） |
| デコレータ `@xxx` | - （TSにもデコレータはあるが用途が異なる） | アトリビュート `#[xxx]` |
