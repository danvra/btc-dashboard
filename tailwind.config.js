export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            colors: {
                canvas: "#f5f5f4",
                ink: "#1c1917",
                accent: "#f97316",
            },
            boxShadow: {
                panel: "0 20px 45px -24px rgba(28, 25, 23, 0.25)",
            },
            borderRadius: {
                "2xl": "1.25rem",
            },
        },
    },
    plugins: [],
};
