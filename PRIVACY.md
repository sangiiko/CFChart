# Privacy Policy for CFChart

Last updated: November 11, 2026

CFChart ("the extension") is an open-source browser extension designed to enhance the Codeforces experience with in-page rating charts, habit tracking, and problem recommendations.

Your privacy is a core priority. This privacy policy explains what information CFChart handles and how it is used.

---

### 1. Information We Collect
CFChart **does not collect, log, or transmit any personal information**. We do not operate tracking servers, telemetry services, analytics engines, or external databases.

### 2. How Data is Accessed and Handled
* **Public Codeforces Data:** To display rating charts, track daily problem goals, and suggest practice problems, CFChart directly queries the official, public Codeforces API (`codeforces.com/api`) for:
  - Public user profile information (`user.info`)
  - Public rating change history (`user.rating`)
  - Public submission history (`user.status`)
  - Public problemset catalog and statistics (`problemset.problems`, `contest.list`)
* **No Authentication Credentials:** CFChart never requests, accesses, stores, or transmits Codeforces passwords, session cookies, or secret API keys.

### 3. Local Data Storage
All data handled by CFChart is stored **strictly locally** on your device using the browser's native `storage.local` API:
* Your chosen Codeforces handle and daily problem target
* Local caches of public contest ratings and submission history to minimize network requests
* Local caching of the public problem catalog

This data never leaves your computer and can be cleared at any time by uninstalling the extension or clearing extension data in your browser settings.

### 4. Local Machine Learning Inference
All machine learning rating forecasts and problem recommendation scoring logic run **100% locally in your browser** via native TypeScript decision tree traversal and scoring algorithms. No user data, submissions, or queries are ever sent to remote AI inference servers.

### 5. Third-Party Services
CFChart communicates exclusively with official Codeforces endpoints (`*.codeforces.com`, `*.codeforces.net`, `*.codeforces.org`) as required to retrieve public competitive programming data. CFChart does not include third-party advertising, trackers, or marketing SDKs.

### 6. Open Source
The full source code of CFChart is open source and available for public audit at:  
https://github.com/sangiiko/CFChart

### 7. Contact
If you have any questions or concerns regarding this privacy policy, please open an issue on the official GitHub repository.
