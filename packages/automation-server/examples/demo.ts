/**
 * End-to-end demo against the running server's HTTP API — the same API the
 * original headless-server template exposed; nothing here changed because
 * of the automation swap. Exercises: generate -> poll status -> save ->
 * fetch the saved .fig -> get a shareable frontend URL.
 *
 * Prerequisites:
 *   1. Open-Pencil frontend running:  bun run dev        (repo root, :1420)
 *   2. This server running:          bun run dev          (packages/automation-server)
 *      with SERVER_API_KEY + FRONTEND_URL + OPENPENCIL_AI_* set in .env
 *
 * Run:
 *   cd packages/automation-server
 *   bun run examples/demo.ts
 */
const BASE_URL = process.env.SERVER_URL ?? 'http://localhost:8780/api/v1'
const API_KEY = process.env.SERVER_API_KEY ?? 'replace-with-a-shared-server-api-key'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${API_KEY}`,
      ...init?.headers
    }
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${init?.method ?? 'GET'} ${path} -> ${response.status}: ${body}`)
  }
  return response.json() as Promise<T>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface EnqueueResponse {
  requestId: string
  queuePosition: number
}

interface StatusResponse {
  requestId: string
  startedAt: number
  completedAt: number | null
  queuePosition: number | null
  failedAt: number | null
  savedAt: number | null
  error: string | null
  result: {
    designId: string
    summary: string
    toolCallCount: number
    hitStepLimit: boolean
    timeUsedMs: number
    toolLog: { tool: string; mutates: boolean }[]
    usage: unknown
  } | null
}

async function waitForCompletion(requestId: string): Promise<StatusResponse> {
  for (;;) {
    const status = await api<StatusResponse>(`/generate/status/${requestId}`)
    if (status.completedAt || status.failedAt) return status
    console.log(`  ...queue position ${status.queuePosition ?? 'processing'}`)
    await sleep(1500)
  }
}

const ctx = `
UI DESIGN REQUIREMENTS
E-Commerce Marketplace Platform (must sure implement all mandatory elements and layouts listed)

1. HOME PAGE
Mandatory elements:
- Header
- Logo
- Search bar
- Account / Login
- Shopping cart
- Main category navigation
- Promotional banner / carousel
- Featured categories
- Flash sale section
- Recommended products
- Popular products / brands
- Product cards
- Footer

2. CATEGORY / PRODUCT LISTING PAGE
Mandatory elements:
- Header
- Breadcrumbs
- Category title
- Subcategory navigation
- Filter panel
- Sort options
- Product result count
- Product grid
- Product cards
- Pagination / infinite scroll
- Empty state
- Footer

3. SEARCH RESULTS PAGE
Mandatory elements:
- Search bar with current keyword
- Search result count
- Related search suggestions
- Filter controls
- Sort controls
- Product grid
- Product cards
- No-results state
- Pagination / infinite scroll

4. PRODUCT DETAIL PAGE
Mandatory elements:
- Image gallery
- Product title
- Brand / seller information
- Rating and review count
- Current price
- Original price
- Discount information
- Promotion badges
- Product variants
- Quantity selector
- Stock / availability status
- Delivery information
- Add to Cart button
- Buy Now button
- Wishlist button
- Product description
- Product specifications
- Customer reviews
- Related / recommended products

5. SHOPPING CART PAGE
Mandatory elements:
- Cart header
- Select all checkbox
- Selected products
- Product image
- Product name
- Seller
- Price
- Quantity selector
- Remove action
- Wishlist action
- Item subtotal
- Coupon / promotion section
- Delivery fee
- Total amount
- Checkout button
- Empty cart state

6. CHECKOUT PAGE
Mandatory elements:
- Delivery address
- Recipient information
- Delivery method
- Delivery time selection
- Order item list
- Product quantity
- Product price
- Coupon / promotion selection
- Payment method
- Subtotal
- Delivery fee
- Discount
- Final total
- Place Order button

7. ORDER CONFIRMATION PAGE
Mandatory elements:
- Order success status
- Order number
- Order summary
- Purchased products
- Delivery address
- Payment method
- Total amount
- Estimated delivery information
- View Order button
- Continue Shopping button

8. ACCOUNT PAGE
Mandatory elements:
- Profile information
- Account navigation
- Order summary
- Pending payment
- Processing orders
- Shipping orders
- Completed orders
- Cancelled / refunded orders
- Wishlist
- Coupons
- Saved addresses
- Payment methods
- Account settings

9. ORDER DETAIL / TRACKING PAGE
Mandatory elements:
- Order number
- Order status
- Order status timeline
- Product information
- Seller information
- Delivery address
- Delivery method
- Tracking information
- Payment summary
- Total amount
- Contact seller / customer service
- Cancel order action where applicable
- Return / refund action where applicable

10. WISHLIST PAGE
Mandatory elements:
- Wishlist title
- Saved product list
- Product cards
- Current price
- Discount information
- Stock status
- Add to Cart button
- Remove button
- Empty wishlist state

11. PRODUCT REVIEW PAGE
Mandatory elements:
- Product information
- Overall rating
- Rating breakdown
- Customer reviews
- Review images / videos
- Rating filters
- Review sorting
- Write Review button
- Review submission form

12. STORE / SELLER PAGE
Mandatory elements:
- Store banner
- Store logo
- Store name
- Follow Store button
- Store rating
- Store categories
- Store promotions
- Featured products
- Product listing
- Filter controls
- Sort controls
- Store information

13. PROMOTION / FLASH SALE PAGE
Mandatory elements:
- Promotion banner
- Countdown timer
- Promotion categories
- Flash-sale product list
- Discount price
- Original price
- Stock / sold information
- Add to Cart button
- Product filters

14. COUPON / VOUCHER PAGE
Mandatory elements:
- Available coupons
- Used coupons
- Expired coupons
- Coupon value
- Minimum spending requirement
- Expiry date
- Applicable products / categories
- Use Now button
- Empty state

15. NOTIFICATION PAGE
Mandatory elements:
- Notification categories / tabs
- Order notifications
- Promotional notifications
- System notifications
- Read / unread status
- Mark as read action
- Empty state

16. CUSTOMER SERVICE PAGE
Mandatory elements:
- FAQ search
- FAQ categories
- Order help
- Delivery help
- Payment help
- Return / refund help
- Contact customer service
- Live chat interface

17. LOGIN / REGISTRATION PAGE
Mandatory elements:
- Logo
- Email / phone input
- Password input
- Verification code
- Login button
- Registration button
- Forgot password
- Terms and privacy agreement
- Optional third-party login

18. ADDRESS MANAGEMENT PAGE
Mandatory elements:
- Saved address list
- Recipient name
- Phone number
- Address
- Default address indicator
- Add Address button
- Edit button
- Delete button
- Set as Default action

19. ERROR / EMPTY STATE PAGES
Mandatory elements:
- 404 page
- No search results
- Empty cart
- Empty wishlist
- No orders
- Product unavailable
- Network / system error
- Loading state
- Retry action
- Back / Home action

20. GLOBAL UI COMPONENTS
Mandatory elements:
- Header
- Logo
- Search bar
- Main navigation
- Breadcrumbs
- Product cards
- Buttons
- Dropdowns
- Filters
- Tabs
- Modal dialogs
- Toast notifications
- Form fields
- Input validation states
- Loading indicators
- Badges
- Price and discount components
- Pagination
- Footer
- Responsive navigation
- Mobile bottom navigation
- Empty states
- Error states

21. RESPONSIVE UI REQUIREMENTS
Mandatory layouts:
- Desktop
- Tablet
- Mobile

Mandatory considerations:
- Responsive grid
- Responsive navigation
- Mobile-friendly search
- Touch-friendly buttons
- Collapsible filters
- Mobile product gallery
- Sticky shopping cart / checkout actions
- Adaptive typography
- Consistent spacing across screen sizes

22. REQUIRED UI STATES
Every interactive component should define:
- Default
- Hover
- Focus
- Active
- Selected
- Disabled
- Loading
- Success
- Error
- Empty
`

// const ctx = `
// UI DESIGN REQUIREMENTS
// E-Commerce Marketplace Platform

// 1. HOME PAGE
// Mandatory elements:
// - Header
// - Logo
// - Search bar
// - Account / Login
// - Shopping cart
// - Main category navigation
// - Promotional banner / carousel
// - Featured categories
// - Flash sale section
// - Recommended products
// - Popular products / brands
// - Product cards
// - Footer

// 2. CATEGORY / PRODUCT LISTING PAGE
// Mandatory elements:
// - Header
// - Breadcrumbs
// - Category title
// - Subcategory navigation
// - Filter panel
// - Sort options
// - Product result count
// - Product grid
// - Product cards
// - Pagination / infinite scroll
// - Empty state
// - Footer

// 3. SEARCH RESULTS PAGE
// Mandatory elements:
// - Search bar with current keyword
// - Search result count
// - Related search suggestions
// - Filter controls
// - Sort controls
// - Product grid
// - Product cards
// - No-results state
// - Pagination / infinite scroll
// `

async function main() {
  console.log('1. Enqueue a new design...')
  const enqueue = await api<EnqueueResponse>('/generate', {
    method: 'POST',
    body: JSON.stringify({
      // prompt: 'Create a simple pricing page with three tiers: Free, Pro, and Enterprise.',
      prompt: ctx,
      autosave: true
    })
  })
  console.log(`   requestId=${enqueue.requestId} queuePosition=${enqueue.queuePosition}`)

  console.log('2. Poll until it completes...')
  const status = await waitForCompletion(enqueue.requestId)
  if (status.failedAt || !status.result) {
    throw new Error(`Generation failed: ${status.error}`)
  }
  console.log({ status: JSON.stringify(status) })
  const { designId, summary, toolCallCount, timeUsedMs } = status.result
  console.log(`   designId=${designId} toolCalls=${toolCallCount} timeUsedMs=${timeUsedMs}`)
  console.log(`   summary: ${summary.slice(0, 200)}${summary.length > 200 ? '...' : ''}`)

  // console.log("3. Save the design...");
  // const saved = await api<{ designId: string; savedBytes: number }>(
  //   `/design/${designId}/save`,
  //   { method: "POST" },
  // );
  // console.log(`   saved ${saved.savedBytes} bytes`);

  console.log('4. Get a shareable frontend URL for it...')
  const frontendUrl = await api<{ url: string }>(`/design/${designId}/url`)
  console.log(`   ${frontendUrl.url}`)

  console.log('5. Fetch the saved .fig bytes directly...')
  const figResponse = await fetch(`${BASE_URL}/design/${designId}`, {
    headers: { authorization: `Bearer ${API_KEY}` }
  })
  const figBytes = new Uint8Array(await figResponse.arrayBuffer())
  console.log(`   downloaded ${figBytes.byteLength} bytes`)

  console.log('\nDone.')
}

main().catch((error) => {
  console.error('Demo failed:', error)
  process.exitCode = 1
})
