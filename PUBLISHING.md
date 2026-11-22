# Publishing the Gr8Mail SDKs

How to publish **`gr8mail`** to **npm** (Node.js) and **PyPI** (Python), and how to release new versions.

| Package | Folder | Registry | Install command once published |
|---|---|---|---|
| Node.js / TypeScript | `node/` | https://www.npmjs.com/package/gr8mail | `npm install gr8mail` |
| Python | `python/` | https://pypi.org/project/gr8mail/ | `pip install gr8mail` |

> **Publishing is permanent.** A version number can never be reused on npm or PyPI, even after you delete it.
> Test first (steps below), then publish.

---

## 0. One-time setup

### Accounts
1. **npm:** create an account at https://www.npmjs.com/signup (use `thegr8labs@gmail.com` or a team address).
   Turn on **two-factor authentication**: Account → Two-Factor Authentication → *Authorization and writes*.
2. **PyPI:** create an account at https://pypi.org/account/register/ and turn on 2FA (required by PyPI).
   Also create an account on **TestPyPI** (https://test.pypi.org/account/register/). It's a separate practice site.

### Check the names are still free
```bash
npm view gr8mail            # "404 Not Found" = free
curl -s -o /dev/null -w "%{http_code}\n" https://pypi.org/pypi/gr8mail/json   # 404 = free
```
If a name is taken, use a scoped npm name such as `@thegr8labs/gr8mail` (change `"name"` in `node/package.json`)
and a different PyPI name in `python/pyproject.toml`.

### Repository visibility (optional)
The npm and PyPI pages link to `https://github.com/thegr8labs/gr8mail-SDK`. If the repo stays **private**, people
can install the packages but can't open the source link. Make it public under GitHub → Settings → *Change visibility*
if you want people to see the code.

### Tools
- Node.js 18+ and npm (`node -v`, `npm -v`)
- Python 3.9+ (`python3 --version`)

---

## 1. Publish the Node.js package (npm)

All commands run inside `node/`.

```bash
cd node
npm install          # dev tools (TypeScript)
npm test             # builds dist/ and runs the tests, must say "fail 0"
```

**Check exactly what will be uploaded.** You should see only `README.md`, `LICENSE`, `package.json` and `dist/`:
```bash
npm pack --dry-run
```

**Try it locally before publishing** (optional but recommended):
```bash
npm pack                                   # creates gr8mail-0.1.0.tgz
mkdir /tmp/try-gr8mail && cd /tmp/try-gr8mail && npm init -y >/dev/null
npm install /path/to/gr8mail-SDK/node/gr8mail-0.1.0.tgz
node -e 'const { Gr8Mail } = require("gr8mail"); console.log(typeof Gr8Mail)'   # → function
cd - && rm gr8mail-*.tgz
```

**Log in and publish:**
```bash
npm login                      # opens the browser; confirm with your 2FA code
npm publish --access public    # asks for your 2FA code again
```
(`--access public` is required only for scoped names like `@thegr8labs/gr8mail`; it's harmless otherwise.)

**Check it worked:**
```bash
npm view gr8mail version       # → 0.1.0
```
The package page is https://www.npmjs.com/package/gr8mail.

---

## 2. Publish the Python package (PyPI)

All commands run inside `python/`.

### Build
```bash
cd python
python3 -m venv .venv && source .venv/bin/activate
pip install --upgrade pip build twine
PYTHONPATH=src python -m unittest discover -s tests -v    # must end with "OK"
rm -rf dist && python -m build                            # creates dist/*.whl and dist/*.tar.gz
twine check dist/*                                        # must say PASSED twice
```

### Create API tokens
- PyPI: https://pypi.org/manage/account/token/ → *Add API token* → scope **Entire account** for the very first
  upload (a project-scoped token isn't possible until the project exists). After the first upload, replace it with
  a token scoped to the `gr8mail` project only.
- TestPyPI: https://test.pypi.org/manage/account/token/ (same steps).

Tokens start with `pypi-`. Twine asks for them when you upload: the **username is `__token__`** and the
**password is the token**. To avoid typing them every time, create `~/.pypirc` (keep it private: `chmod 600 ~/.pypirc`):
```ini
[pypi]
username = __token__
password = pypi-AgEIcHlwaS5vcmc...

[testpypi]
repository = https://test.pypi.org/legacy/
username = __token__
password = pypi-AgENdGVzdC5weXBp...
```

### Rehearse on TestPyPI
```bash
twine upload --repository testpypi dist/*

# install it in a clean environment to be sure it works
python3 -m venv /tmp/try-gr8mail && /tmp/try-gr8mail/bin/pip install \
  --index-url https://test.pypi.org/simple/ --no-deps gr8mail
/tmp/try-gr8mail/bin/python -c "import gr8mail; print(gr8mail.__version__)"    # → 0.1.0
```

### Publish for real
```bash
twine upload dist/*
```

**Check it worked:**
```bash
pip index versions gr8mail      # or open https://pypi.org/project/gr8mail/
```

---

## 3. Releasing a new version

Use [semantic versioning](https://semver.org): `0.1.1` for fixes, `0.2.0` for new features, `1.0.0` when the API
is stable. Breaking changes need a new major version (after 1.0).

The version appears in **two places per package**. Keep them identical:

| Package | Update both |
|---|---|
| Node | `node/package.json` → `"version"` and `node/src/index.ts` → `export const VERSION` |
| Python | `python/pyproject.toml` → `version` and `python/src/gr8mail/_client.py` → `VERSION` |

The `VERSION` constant is sent in the `User-Agent` header, so the server logs show which SDK version clients use.

Then:
```bash
# Node
cd node && npm test && npm publish

# Python
cd python && rm -rf dist && python -m build && twine check dist/* && twine upload dist/*

# Record the release in git
git add -A && git commit -m "Release 0.1.1"
git tag node-v0.1.1 && git tag python-v0.1.1
git push && git push --tags
```

Write what changed in the GitHub release notes (GitHub → Releases → *Draft a new release* → pick the tag).

---

## 4. Optional: publish automatically from GitHub

Once you're comfortable publishing by hand, you can let GitHub publish when you push a tag.

**npm:** create an *Automation* access token at npmjs.com → Access Tokens, and save it in the repo as
GitHub → Settings → Secrets and variables → Actions → `NPM_TOKEN`.

**PyPI:** use *Trusted Publishing* (no token needed): on PyPI open the project → *Publishing* → add a GitHub
publisher with owner `thegr8labs`, repository `gr8mail-SDK`, workflow `publish.yml`, environment `pypi`.

`.github/workflows/publish.yml`:
```yaml
name: Publish
on:
  push:
    tags: ["node-v*", "python-v*"]

jobs:
  npm:
    if: startsWith(github.ref_name, 'node-v')
    runs-on: ubuntu-latest
    permissions: { contents: read, id-token: write }
    defaults: { run: { working-directory: node } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, registry-url: "https://registry.npmjs.org" }
      - run: npm ci && npm test
      - run: npm publish --provenance --access public
        env: { NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" }

  pypi:
    if: startsWith(github.ref_name, 'python-v')
    runs-on: ubuntu-latest
    environment: pypi
    permissions: { id-token: write }
    defaults: { run: { working-directory: python } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.12" }
      - run: pip install build && PYTHONPATH=src python -m unittest discover -s tests && python -m build
      - uses: pypa/gh-action-pypi-publish@release/v1
        with: { packages-dir: python/dist }
```
`--provenance` adds a verified "Built and signed on GitHub Actions" badge on npm. It requires the repo to be public.

---

## 5. Troubleshooting

| Error | Cause and fix |
|---|---|
| npm `403 ... You do not have permission to publish "gr8mail"` | Name taken by someone else, or you're logged into another account (`npm whoami`). Use a scoped name. |
| npm `cannot publish over the previously published versions` | That version already exists. Bump the version (section 3). |
| npm `EOTP` / asks for a one-time password | Enter the 6-digit code from your authenticator app, or run `npm publish --otp=123456`. |
| PyPI `400 File already exists` | That version was already uploaded (even if deleted). Bump the version and rebuild. |
| PyPI `403 Invalid or non-existent authentication` | Username must be exactly `__token__`, password the full `pypi-…` token. |
| PyPI `The user ... isn't allowed to upload to project` | The name is taken; choose another `name` in `pyproject.toml`. |
| README looks wrong on PyPI | Run `twine check dist/*`; it must pass. PyPI renders `python/README.md`. |
| `ModuleNotFoundError: gr8mail` after installing from TestPyPI | You installed into a different Python. Use the venv's own `pip`/`python` as shown above. |

---

## 6. Release checklist

- [ ] Tests pass (`npm test` / `python -m unittest`)
- [ ] Version bumped in both places for that package
- [ ] `npm pack --dry-run` shows only `dist/`, README, LICENSE, package.json
- [ ] `twine check dist/*` passes; rehearsed on TestPyPI
- [ ] Published; `npm view gr8mail version` / PyPI page shows the new version
- [ ] Git commit + tag pushed; GitHub release notes written
- [ ] Docs on https://mail.thegr8labs.com/docs still match the SDK
