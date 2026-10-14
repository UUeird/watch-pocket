// Every country a brand can name, with its flag. East Germany no longer exists and has no flag emoji.
export const countries = {
  Austria: { flag: '🇦🇹' },
  Belarus: { flag: '🇧🇾' },
  Belgium: { flag: '🇧🇪' },
  Brazil: { flag: '🇧🇷' },
  Canada: { flag: '🇨🇦' },
  China: { flag: '🇨🇳' },
  Denmark: { flag: '🇩🇰' },
  'East Germany': { flag: undefined },
  Finland: { flag: '🇫🇮' },
  France: { flag: '🇫🇷' },
  Germany: { flag: '🇩🇪' },
  'Hong Kong': { flag: '🇭🇰' },
  India: { flag: '🇮🇳' },
  Israel: { flag: '🇮🇱' },
  Italy: { flag: '🇮🇹' },
  Japan: { flag: '🇯🇵' },
  Lithuania: { flag: '🇱🇹' },
  Netherlands: { flag: '🇳🇱' },
  Russia: { flag: '🇷🇺' },
  Singapore: { flag: '🇸🇬' },
  'South Korea': { flag: '🇰🇷' },
  Spain: { flag: '🇪🇸' },
  Sweden: { flag: '🇸🇪' },
  Switzerland: { flag: '🇨🇭' },
  'United Kingdom': { flag: '🇬🇧' },
  'United States': { flag: '🇺🇸' },
} satisfies Record<string, { flag: string | undefined }>;

export type CountryName = keyof typeof countries;
export const countryNames = Object.keys(countries) as [CountryName, ...CountryName[]];
