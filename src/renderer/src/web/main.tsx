// Web entry point. Import order matters: install the browser bridge first,
// then load the exact same editor the desktop app runs.
import { inject } from '@vercel/analytics'
import './install'
import '../main'

// Anonymous page-view counts for the hosted web version (Vercel Web Analytics:
// no cookies, no personal data, nothing from your projects). The desktop app
// never loads this file, so it sends nothing at all.
inject()
