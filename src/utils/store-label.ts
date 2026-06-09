// A store's display label. The stores.name column already carries the chain by
// data convention ("Chain @ Location", e.g. "Best Denki @ Vivocity"), so naively
// appending the chain again produced "Best Denki @ Vivocity @ Best Denki". Only
// append the chain when the name doesn't already start with it (true for 0 of
// 108 current stores, but keeps us correct if someone adds a chain-less name).
export function storeLabel(
  s: { name?: string | null; chain?: string | null } | null | undefined,
): string {
  const name = s?.name?.trim() || 'a store';
  const chain = s?.chain?.trim();
  if (!chain) return name;
  return name.toLowerCase().startsWith(chain.toLowerCase()) ? name : `${name} @ ${chain}`;
}
