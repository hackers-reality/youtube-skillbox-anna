import "./review.css";

export const metadata = {
  title: "YouTube Skillbox · Design Review",
  description: "A private design preview of the YouTube Skillbox creator workspace with server-side NVIDIA LLM chat.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }) {
  return <html lang="en"><body>{children}</body></html>;
}
