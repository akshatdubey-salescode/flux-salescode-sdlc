import { Instrument_Serif } from "next/font/google";

/** The display serif for accent words on the public pages (landing, sign-in). */
export const displaySerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-display-serif",
});
