import type { BodyId } from './catalog'

/** Russian case forms of body names for UI phrases ("у Колосса", "к Ауруму", "в Рубру", "с Руброй"). */
const FORMS: Record<BodyId, { gen: string; dat: string; acc: string; ins: string }> = {
  lyra: { gen: 'Лиры', dat: 'Лире', acc: 'Лиру', ins: 'Лирой' },
  cinder: { gen: 'Пепла', dat: 'Пеплу', acc: 'Пепел', ins: 'Пеплом' },
  aqua: { gen: 'Аквы', dat: 'Акве', acc: 'Акву', ins: 'Аквой' },
  rubra: { gen: 'Рубры', dat: 'Рубре', acc: 'Рубру', ins: 'Руброй' },
  colossus: { gen: 'Колосса', dat: 'Колоссу', acc: 'Колосс', ins: 'Колоссом' },
  aurum: { gen: 'Аурума', dat: 'Ауруму', acc: 'Аурум', ins: 'Аурумом' },
  borey: { gen: 'Борея', dat: 'Борею', acc: 'Борей', ins: 'Бореем' },
  viola: { gen: 'Виолы', dat: 'Виоле', acc: 'Виолу', ins: 'Виолой' },
}

export const genitiveOf = (id: BodyId): string => FORMS[id].gen
export const dativeOf = (id: BodyId): string => FORMS[id].dat
export const accusativeOf = (id: BodyId): string => FORMS[id].acc
export const instrumentalOf = (id: BodyId): string => FORMS[id].ins
