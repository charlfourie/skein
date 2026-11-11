// Entry point. Import order matters: install the browser bridge first, then
// load the editor.
import { inject } from '@vercel/analytics'
import './install'
import '../main'

// Anonymous page-view counts for the hosted web version (Vercel Web Analytics:
// no cookies, no personal data, nothing from your projects). Self-hosted copies
// report nothing unless their own Vercel project enables it.
inject()
