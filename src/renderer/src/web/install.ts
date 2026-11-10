import { browserApi } from './browserApi'

// Must run before any editor module reads `window.api` (some do at import time).
window.api = browserApi
