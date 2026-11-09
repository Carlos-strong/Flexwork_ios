// Villes principales par pays, pour la cascade Pays → Ville du formulaire de mission.
//
// Aucun référentiel de villes n'existe en base, et en créer un (table + administration +
// import) serait un chantier à part entière pour une liste qui ne bouge pas. C'est donc une
// constante, comme `COUNTRIES` dont elle suit exactement les codes : les sept pays ouverts à
// l'inscription sont couverts, aucun autre.
//
// `autre` est volontaire : la liste n'est pas exhaustive, et une mission dans une ville
// absente doit rester publiable. Le champ libre prend alors le relais côté formulaire.
export const CITIES_BY_COUNTRY: Record<string, readonly string[]> = {
  BJ: ["Cotonou", "Porto-Novo", "Parakou", "Abomey-Calavi", "Bohicon", "Djougou", "Natitingou"],
  TG: ["Lomé", "Sokodé", "Kara", "Kpalimé", "Atakpamé"],
  SN: ["Dakar", "Thiès", "Saint-Louis", "Touba", "Ziguinchor", "Kaolack"],
  CI: ["Abidjan", "Yamoussoukro", "Bouaké", "Daloa", "San-Pédro", "Korhogo"],
  BF: ["Ouagadougou", "Bobo-Dioulasso", "Koudougou", "Banfora"],
  NE: ["Niamey", "Zinder", "Maradi", "Agadez"],
  NG: ["Lagos", "Abuja", "Kano", "Ibadan", "Port Harcourt"],
};

export function citiesFor(countryCode: string | null | undefined): readonly string[] {
  return (countryCode && CITIES_BY_COUNTRY[countryCode]) || [];
}
