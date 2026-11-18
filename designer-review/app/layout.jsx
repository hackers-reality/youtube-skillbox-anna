import "./review.css";

export const metadata = {
  title: "YouTube Skillbox · Design Review",
  description: "A safe, sample-data preview of the YouTube Skillbox creator workspace.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
