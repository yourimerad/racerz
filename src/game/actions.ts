import { type ModelId, type Profile, type SkinId, buyCar, buySkin, equipSkin, selectCar } from "./garage";

/** What the garage and skin shop can do to the profile; where the change is stored depends on who plays. */
export type ProfileActions = {
  buyCar(id: ModelId): void;
  buySkin(id: SkinId): void;
  equipSkin(id: SkinId): void;
  selectCar(id: ModelId): void;
};

/** Guest and debug play: a pure update of whichever profile is active. */
export function localActions(get: () => Profile, set: (p: Profile) => void): ProfileActions {
  return {
    buyCar: (id) => set(buyCar(get(), id)),
    buySkin: (id) => set(buySkin(get(), id)),
    equipSkin: (id) => set(equipSkin(get(), id)),
    selectCar: (id) => set(selectCar(get(), id)),
  };
}
