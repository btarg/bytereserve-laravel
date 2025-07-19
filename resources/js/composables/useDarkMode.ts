import { ref, watch, onMounted } from 'vue';

const isDarkMode = ref(false);

export function useDarkMode() {
    // Initialize from localStorage or system preference
    const initializeDarkMode = () => {
        const stored = localStorage.getItem('darkMode');
        if (stored !== null) {
            isDarkMode.value = stored === 'true';
        } else {
            // Check system preference
            isDarkMode.value = window.matchMedia('(prefers-color-scheme: dark)').matches;
        }
        applyDarkMode();
    };

    // Apply dark mode to document
    const applyDarkMode = () => {
        if (isDarkMode.value) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    };

    // Toggle dark mode
    const toggleDarkMode = () => {
        isDarkMode.value = !isDarkMode.value;
        localStorage.setItem('darkMode', isDarkMode.value.toString());
        applyDarkMode();
    };

    // Watch for changes and apply them
    watch(isDarkMode, applyDarkMode);

    // Listen for system theme changes
    onMounted(() => {
        initializeDarkMode();
        
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleSystemThemeChange = (e: MediaQueryListEvent) => {
            // Only update if user hasn't manually set a preference
            if (localStorage.getItem('darkMode') === null) {
                isDarkMode.value = e.matches;
            }
        };
        
        mediaQuery.addEventListener('change', handleSystemThemeChange);
        
        // Cleanup
        return () => {
            mediaQuery.removeEventListener('change', handleSystemThemeChange);
        };
    });

    return {
        isDarkMode,
        toggleDarkMode
    };
}
