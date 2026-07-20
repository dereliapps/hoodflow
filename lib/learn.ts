export const learnArticles = [
  {
    slug: "how-to-trade-stock-tokens-on-robinhood-chain",
    title: "How to trade Stock Tokens on Robinhood Chain",
    excerpt: "A plain-language walkthrough of wallet connection, USDG routes, quotes, permissions and self-custody settlement.",
    readingTime: "6 min",
    sections: [
      ["Before you start", "You need an EVM wallet connected to Robinhood Chain, USDG for the supported buy routes and a small ETH balance for network gas. Stock Tokens are derivative instruments, not shares, and access may be restricted by jurisdiction."],
      ["Choose a route-ready market", "HoodFlow indexes canonical token contracts from Robinhood Chain. A market becomes trade-enabled only after its configured route completes a full-input test. Watch-only means the token is visible but the order button remains blocked."],
      ["Read the live quote", "Enter an amount and wait for the automatic route quote. Review estimated output, minimum received, pool fee, HoodFlow fee and network gas disclosure. The oracle is a safety reference; the DEX quote is the amount the router can currently fill."],
      ["Confirm inside your wallet", "The wallet may first request an exact Permit2 approval and then the router transaction. Check the token, amount, spender and expiry. The purchased token settles to the connected wallet; HoodFlow does not custody it."],
    ],
  },
  {
    slug: "stock-tokens-vs-traditional-stocks",
    title: "Stock Tokens vs traditional stocks",
    excerpt: "What changes when market exposure is represented by an onchain derivative instead of a brokerage share position.",
    readingTime: "5 min",
    sections: [
      ["They are not the same instrument", "A traditional share represents equity ownership. Robinhood describes its Stock Tokens as derivative contracts that track an underlying security without granting shareholder rights. Token mechanics, issuer terms and jurisdiction rules matter."],
      ["Trading hours and liquidity differ", "Robinhood describes Classic Stock Token access as 24 hours a day from Monday through Friday. Onchain pools can still have thin liquidity or stale reference data outside the underlying US core session, so execution quality can differ from a brokerage quote."],
      ["Self-custody changes responsibility", "A self-custody wallet gives the user control of keys and tokens, but also makes transaction review essential. A mistaken address, malicious token or unsafe permission may not be reversible."],
      ["HoodFlow's role", "HoodFlow is an independent interface. It separates the reference price from the executable route, applies a minimum output and displays the permission window. It does not issue the Stock Token or guarantee its value."],
    ],
  },
  {
    slug: "what-is-slippage-in-stock-token-swaps",
    title: "What is slippage in a Stock Token swap?",
    excerpt: "How price movement, pool depth and minimum output determine whether an onchain order fills or reverts.",
    readingTime: "4 min",
    sections: [
      ["The simple definition", "Slippage is the difference between the quoted output and the minimum output you are willing to accept. A 0.5% setting tells the router to revert if the delivered amount falls below 99.5% of the fresh quote."],
      ["Why it grows", "Larger orders move farther through a pool. Thin liquidity, changing prices and extended-hours trading can widen the difference between the first quote and wallet confirmation."],
      ["Lower is not always better", "A very tight setting gives stronger price protection but can cause more failed transactions when a market is moving. A wider setting may fill more easily but accepts a worse minimum. HoodFlow limits the available range and shows the output floor before submission."],
      ["What a revert means", "A slippage revert means the protection worked: the router did not accept an output below your floor. Request a new quote, reassess the amount and never treat repeated reverts as a reason to sign a blind transaction."],
    ],
  },
  {
    slug: "stock-token-market-hours-and-weekend-gap-risk",
    title: "Stock Token market hours and weekend gap risk",
    excerpt: "Understand the difference between a live blockchain, a 24/5 issuer window and the underlying US core session.",
    readingTime: "5 min",
    sections: [
      ["Three clocks can be running", "Robinhood Chain can produce blocks continuously. Robinhood's Classic Stock Token window is described as 24/5, while the underlying US core session normally runs 9:30 a.m. to 4:00 p.m. Eastern Time on business days."],
      ["Closed does not mean zero activity", "A DEX pool may still exist outside the underlying core session. However, liquidity can thin and an oracle round can remain unchanged. That is why HoodFlow shows both market-status badges and still asks the pool for a fresh quote."],
      ["Weekend gap risk", "Material news can arrive while the issuer reference window is closed. When prices resume, the next reference may jump. A stale-price guard or unavailable route should block execution rather than assume Friday's value is current."],
      ["Practical checks", "Inspect quote age, pool fee, minimum output and oracle status. Consider a smaller amount when liquidity is thin, and wait when the reference feed or route cannot be verified."],
    ],
  },
  {
    slug: "how-hoodflow-fees-work",
    title: "How HoodFlow fees work",
    excerpt: "A transparent breakdown of pool fees, network gas and the difference between direct swaps and DCA automation.",
    readingTime: "4 min",
    sections: [
      ["Direct Buy and Sell", "HoodFlow currently adds a 0.00% interface fee to direct swaps. The selected Uniswap pool fee remains part of execution and is displayed with the live quote."],
      ["Network gas", "Robinhood Chain transactions use ETH for gas. The wallet estimates and displays the network cost before signing. Gas goes to the network, not to HoodFlow."],
      ["DCA automation", "Recurring strategies use a separate engine. Its current protocol fee is read from the deployed contract and displayed before strategy creation. The pool fee and gas are determined when a keeper executes each scheduled trade."],
      ["Why quotes can still differ", "Fees are only one part of execution. Pool depth, order size and price movement affect output. Always compare the fresh estimate with the protected minimum."],
    ],
  },
] as const;

export function getLearnArticle(slug: string) {
  return learnArticles.find((article) => article.slug === slug);
}
