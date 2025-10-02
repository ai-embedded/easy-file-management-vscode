import { Logger } from '../../shared/utils/Logger';

type ThemeKind = 'light' | 'dark' | 'highContrast';
type ThemeAppearance = 'light' | 'dark';

interface ThemeBridgeMetadata {
  kind?: string;
  appearance?: string;
  label?: string;
  id?: string;
  kindNumeric?: number;
  timestamp?: string;
}

interface ThemeMessageEventData {
  command?: string;
  data?: ThemeBridgeMetadata;
}

const themeClassMap: Record<string, ThemeKind> = {
	'vscode-dark': 'dark',
	'vscode-high-contrast': 'highContrast',
	'vscode-high-contrast-light': 'highContrast',
	'vscode-light': 'light'
};

const baseTokenOverrides: Record<string, string> = {
	'--el-bg-color': 'var(--vscode-editor-background)',
	'--el-bg-color-page': 'var(--vscode-editor-background)',
	'--el-bg-color-overlay': 'var(--vscode-dropdown-background)',
	'--el-bg-color-secondary': 'var(--vscode-editorPane-background, var(--vscode-editor-background))',
	'--el-text-color-primary': 'var(--vscode-editor-foreground)',
	'--el-text-color-regular': 'var(--vscode-foreground)',
	'--el-text-color-secondary': 'var(--vscode-descriptionForeground)',
	'--el-text-color-placeholder': 'var(--vscode-descriptionForeground)',
	'--el-text-color-disabled': 'var(--vscode-disabledForeground)',
	'--el-border-color': 'var(--vscode-panel-border)',
	'--el-border-color-dark': 'var(--vscode-panel-border)',
	'--el-border-color-darker': 'var(--vscode-panel-border)',
	'--el-border-color-light':
		'color-mix(in srgb, var(--vscode-panel-border) 70%, transparent)',
	'--el-border-color-lighter':
		'color-mix(in srgb, var(--vscode-panel-border) 40%, transparent)',
	'--el-border-color-extra-light':
		'color-mix(in srgb, var(--vscode-panel-border) 20%, transparent)',
	'--el-fill-color':
		'color-mix(in srgb, var(--vscode-editor-background) 92%, #000 8%)',
	'--el-fill-color-light':
		'color-mix(in srgb, var(--vscode-editor-background) 95%, #000 5%)',
	'--el-fill-color-lighter':
		'color-mix(in srgb, var(--vscode-editor-background) 97%, #000 3%)',
	'--el-fill-color-extra-light':
		'color-mix(in srgb, var(--vscode-editor-background) 98%, #000 2%)',
	'--el-fill-color-dark':
		'color-mix(in srgb, var(--vscode-editor-background) 85%, #000 15%)',
	'--el-fill-color-darker':
		'color-mix(in srgb, var(--vscode-editor-background) 75%, #000 25%)',
	'--el-fill-color-blank': 'var(--vscode-editor-background)',
	'--el-mask-color': 'rgba(0, 0, 0, 0.45)',
	'--el-mask-color-extra-light': 'rgba(0, 0, 0, 0.25)',
	'--el-color-primary': 'var(--vscode-button-background)',
	'--el-color-primary-light-3':
		'color-mix(in srgb, var(--vscode-button-background) 70%, var(--vscode-editor-background))',
	'--el-color-primary-light-5':
		'color-mix(in srgb, var(--vscode-button-background) 50%, var(--vscode-editor-background))',
	'--el-color-primary-light-7':
		'color-mix(in srgb, var(--vscode-button-background) 30%, var(--vscode-editor-background))',
	'--el-color-primary-dark-2': 'color-mix(in srgb, var(--vscode-button-background) 80%, #000)',
	'--el-color-success': 'var(--vscode-testing-iconPassed, #3ba55c)',
	'--el-color-warning': 'var(--vscode-testing-iconQueued, #dcb67a)',
	'--el-color-danger': 'var(--vscode-testing-iconFailed, #f14c4c)',
	'--el-color-error': 'var(--vscode-testing-iconFailed, #f14c4c)',
	'--el-color-info': 'var(--vscode-editorInfo-foreground, var(--vscode-editor-foreground))',
	'--el-font-color-disabled': 'var(--vscode-disabledForeground)',
	'--el-box-shadow': 'var(--vscode-widget-shadow, rgba(0, 0, 0, 0.2))',
	'--el-hover-bg-color':
		'color-mix(in srgb, var(--vscode-editor-background) 88%, rgba(255, 255, 255, 0.12))',
	'--el-active-bg-color':
		'color-mix(in srgb, var(--vscode-editor-background) 70%, rgba(0, 0, 0, 0.3))',
	'--el-overlay-color': 'rgba(0, 0, 0, 0.55)',
	'--el-overlay-color-light': 'rgba(0, 0, 0, 0.4)',
	'--el-overlay-color-lighter': 'rgba(0, 0, 0, 0.3)',
	'--el-overlay-color-dark': 'rgba(0, 0, 0, 0.65)'
};

const highContrastOverrides: Record<string, string> = {
	'--el-border-color': 'var(--vscode-contrastBorder, var(--vscode-panel-border))',
	'--el-border-color-light': 'var(--vscode-contrastBorder, var(--vscode-panel-border))',
	'--el-border-color-lighter': 'var(--vscode-contrastBorder, var(--vscode-panel-border))',
	'--el-fill-color': 'var(--vscode-editor-background)',
	'--el-fill-color-light': 'var(--vscode-editor-background)',
	'--el-fill-color-lighter': 'var(--vscode-editor-background)',
	'--el-hover-bg-color': 'color-mix(in srgb, var(--vscode-editor-background) 82%, rgba(255, 255, 255, 0.2))'
};

function normalizeThemeKind(value: unknown): ThemeKind | undefined {
	if (typeof value === 'number') {
		switch (value) {
			case 1:
				return 'light';
			case 2:
				return 'dark';
			case 3:
			case 4:
				return 'highContrast';
			default:
				return undefined;
		}
	}

	if (typeof value === 'string') {
		const normalized = value.toLowerCase();
		if (normalized.includes('high')) {
			return 'highContrast';
		}
		if (normalized.includes('dark')) {
			return 'dark';
		}
		if (normalized.includes('light')) {
			return 'light';
		}
	}

	return undefined;
}

function normalizeAppearance(value: unknown, fallback: ThemeAppearance): ThemeAppearance {
	if (typeof value === 'string') {
		const normalized = value.toLowerCase();
		if (normalized.includes('dark')) {
			return 'dark';
		}
		if (normalized.includes('light')) {
			return 'light';
		}
	}
	return fallback;
}

function inferThemeFromBody(body: HTMLElement): ThemeKind {
	for (const className of body.classList) {
		const mapped = themeClassMap[className];
		if (mapped) {
			return mapped;
		}
	}
	return 'light';
}

function applyTokenOverrides(theme: ThemeKind, appearance: ThemeAppearance): void {
	const target = document.documentElement.style;

	Object.entries(baseTokenOverrides).forEach(([token, value]) => {
		target.setProperty(token, value);
	});

	if (theme === 'highContrast') {
		Object.entries(highContrastOverrides).forEach(([token, value]) => {
			target.setProperty(token, value);
		});
	}

	if (appearance === 'light') {
		target.setProperty('--el-mask-color', 'rgba(255, 255, 255, 0.35)');
		target.setProperty('--el-mask-color-extra-light', 'rgba(255, 255, 255, 0.25)');
		target.setProperty('--el-overlay-color', 'rgba(0, 0, 0, 0.35)');
		target.setProperty('--el-overlay-color-light', 'rgba(0, 0, 0, 0.25)');
		target.setProperty('--el-overlay-color-lighter', 'rgba(0, 0, 0, 0.15)');
		target.setProperty(
			'--el-active-bg-color',
			'color-mix(in srgb, var(--vscode-editor-background) 76%, rgba(0, 0, 0, 0.18))'
		);
	} else {
		target.setProperty('--el-mask-color', 'rgba(0, 0, 0, 0.5)');
		target.setProperty('--el-mask-color-extra-light', 'rgba(0, 0, 0, 0.3)');
		target.setProperty('--el-overlay-color', 'rgba(0, 0, 0, 0.6)');
		target.setProperty('--el-overlay-color-light', 'rgba(0, 0, 0, 0.45)');
		target.setProperty('--el-overlay-color-lighter', 'rgba(0, 0, 0, 0.35)');
		target.setProperty(
			'--el-active-bg-color',
			'color-mix(in srgb, var(--vscode-editor-background) 65%, rgba(255, 255, 255, 0.18))'
		);
	}
}

export function initThemeManager(logger: Logger): () => void {
	const themeLogger = logger.createChild('Manager');
	let explicitThemeKind: ThemeKind | undefined;
	let explicitAppearance: ThemeAppearance | undefined;

	const applyTheme = (reason: string, payload?: ThemeBridgeMetadata) => {
		const body = document.body;
		if (!body) {
			themeLogger.warn('Theme apply skipped - body not ready', { reason });
			return;
		}

		const inferredTheme = explicitThemeKind ?? inferThemeFromBody(body);
		const appearanceFallback: ThemeAppearance =
			inferredTheme === 'dark' || inferredTheme === 'highContrast' ? 'dark' : 'light';
		const appearance = explicitAppearance ?? appearanceFallback;

		document.documentElement.style.setProperty('color-scheme', appearance);
		document.body.dataset.vscodeThemeKind = inferredTheme;
		applyTokenOverrides(inferredTheme, appearance);
		document.body.style.backgroundColor = 'var(--el-bg-color-page)';

		themeLogger.info('Applied VS Code theme to webview', {
			reason,
			theme: inferredTheme,
			appearance,
			classList: Array.from(body.classList),
			payloadSummary: payload ? {
				kind: payload.kind,
				appearance: payload.appearance,
				timestamp: payload.timestamp
			} : undefined
		});
	};

	const handleMessage = (event: MessageEvent<ThemeMessageEventData>) => {
		const message = event.data;
		if (!message || message.command !== 'themeChanged') {
			return;
		}

		const payload = message.data;
		const normalizedKind = normalizeThemeKind(payload?.kind ?? payload?.kindNumeric);
		if (normalizedKind) {
			explicitThemeKind = normalizedKind;
		}

		if (payload?.appearance) {
			explicitAppearance = normalizeAppearance(
				payload.appearance,
				explicitThemeKind === 'dark' || explicitThemeKind === 'highContrast' ? 'dark' : 'light'
			);
		}

		themeLogger.debug('Received themeChanged message', {
			kind: payload?.kind,
			kindNumeric: payload?.kindNumeric,
			appearance: payload?.appearance,
			inferredKind: explicitThemeKind,
			inferredAppearance: explicitAppearance
		});

		applyTheme('message:themeChanged', payload);
	};

	window.addEventListener('message', handleMessage);

	const observer = new MutationObserver(() => {
		applyTheme('mutation:body-class');
	});

	const bootstrap = () => {
		const body = document.body;
		if (!body) {
			themeLogger.debug('Body not ready during bootstrap; waiting for DOMContentLoaded');
			return;
		}
		observer.observe(body, { attributes: true, attributeFilter: ['class'] });
		applyTheme('bootstrap');
	};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => {
			bootstrap();
		}, { once: true });
	} else {
		bootstrap();
	}

	return () => {
		observer.disconnect();
		window.removeEventListener('message', handleMessage);
	};
}
