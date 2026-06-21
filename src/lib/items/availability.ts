type ItemAvailability = {
  flags?: {
    lifecycle?: string;
  };
};

export function isRemovedItem(item: ItemAvailability): boolean {
  return item.flags?.lifecycle === "removed";
}

export function activeItems<T extends ItemAvailability>(items: T[]): T[] {
  return items.filter((item) => !isRemovedItem(item));
}
