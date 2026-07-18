export const CHAINLINK_ROBINHOOD_FEED_SOURCE =
  "https://docs.chain.link/data-feeds/price-feeds/addresses?network=robinhood";

export const ROBINHOOD_PRICE_FEEDS = {
  AAPL: { feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", heartbeat: 86_400 },
  AMD: { feed: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72", heartbeat: 86_400 },
  AMZN: { feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", heartbeat: 86_400 },
  BABA: { feed: "0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984", heartbeat: 86_400 },
  // Chainlink's current Robinhood registry does not list a BE feed.
  BE: { feed: null, heartbeat: 86_400 },
  COIN: { feed: "0xA3a468A452940B7D6b69991207B508c609a98Ef2", heartbeat: 86_400 },
  CRCL: { feed: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a", heartbeat: 86_400 },
  CRWV: { feed: "0xe1b3aABCAFAd1c94708dc1367dcfF8Aa4407487C", heartbeat: 86_400 },
  GOOGL: { feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b", heartbeat: 86_400 },
  INTC: { feed: "0x3f390C5C24628Ac7C489515402235FeAD71D1913", heartbeat: 86_400 },
  META: { feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1", heartbeat: 86_400 },
  MSFT: { feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E", heartbeat: 86_400 },
  MU: { feed: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596", heartbeat: 86_400 },
  NVDA: { feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", heartbeat: 86_400 },
  ORCL: { feed: "0x0e6a64a2B58A6693a531E6c555f3A5d042eEA844", heartbeat: 86_400 },
  PLTR: { feed: "0x820ABedFF239034956B7A9d2F0a331f9F075eB4c", heartbeat: 86_400 },
  SNDK: { feed: "0xfb133Fa4B7b385802B693a293606682Df47109A3", heartbeat: 86_400 },
  SPCX: { feed: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb", heartbeat: 86_400 },
  TSLA: { feed: "0x4A1166a659A55625345e9515b32adECea5547C38", heartbeat: 86_400 },
  USAR: { feed: "0xA994d3684e8400A6c8078226925779FdeE682DD9", heartbeat: 86_400 },
  QQQ: { feed: "0x80901d846d5D7B030F26B480776EE3b29374C2ae", heartbeat: 86_400 },
  SGOV: { feed: "0xa0DF4ee0fFf975306345875E3548Fcc519577A11", heartbeat: 86_400 },
  SLV: { feed: "0x209b73908e92Ae021826eD79609845451Ecba2ce", heartbeat: 86_400 },
  SPY: { feed: "0x319724394D3A0e3669269846abE664Cd621f9f6A", heartbeat: 86_400 },
  // CUSO's onchain symbol alias is USO; the official feed is Robinhood USO / USD.
  CUSO: { feed: "0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c", heartbeat: 86_400 },
} as const;

export type RobinhoodPriceTicker = keyof typeof ROBINHOOD_PRICE_FEEDS;
