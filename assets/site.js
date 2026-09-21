const languageSwitchers = document.querySelectorAll('[data-language-switcher]');
const mobileMenus = document.querySelectorAll('.mobile-menu');
const analyticsConfig = window.BaTipAnalytics || {};
const cookieBanner = document.querySelector('[data-cookie-banner]');
const cookiePreferences = document.querySelector('[data-cookie-preferences]');
const cookiePreferencesPanel = cookiePreferences?.querySelector('[role="dialog"]');
const cookieSettingsOpeners = document.querySelectorAll('[data-cookie-settings-open]');
const cookiePurposeInputs = document.querySelectorAll('[data-cookie-purpose]');
const cookieAccept = document.querySelector('[data-cookie-accept]');
const cookieReject = document.querySelector('[data-cookie-reject]');
const cookieRejectAll = document.querySelector('[data-cookie-reject-all]');
const cookieAllowAll = document.querySelector('[data-cookie-allow-all]');
const cookieConfirm = document.querySelector('[data-cookie-confirm]');
const cookieConsentVersion = 1;
const cookiePreferencePageState = new Map();
const initializedDestinations = new Set();
const marketingParameters = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
let cookieConsentMemory = null;
let activeConsent = null;
let googleConsentInitialized = false;
let settingsOpenedFromBanner = false;
let settingsReturnFocus = null;

initializeLocalePreference();
initializeMobileMenus();
initializeScreenshotCarousels();

for (const languageSwitcher of languageSwitchers) {
  languageSwitcher.addEventListener('change', (event) => {
    const nextLocale = event.target.value;
    const pathParts = window.location.pathname.split('/').filter(Boolean);

    sendAnalyticsEvent(
      'feature_click',
      {
        feature_id: 'language_switcher',
        feature_action: 'select_locale',
        selected_locale: nextLocale,
        placement: analyticsPlacement(event.target),
        locale: currentAnalyticsLocale(),
        page_path: window.location.pathname,
      },
      'performance',
    );

    if (pathParts.length === 0) {
      window.location.href = `/${nextLocale}/`;
      return;
    }

    pathParts[0] = nextLocale;
    writeLocalePreference(nextLocale);
    window.location.href = `/${pathParts.join('/')}/`;
  });
}

function initializeMobileMenus() {
  for (const menu of mobileMenus) {
    const summary = menu.querySelector('.mobile-menu-button');
    const backdrop = menu.querySelector('[data-mobile-menu-close]');

    const closeMenu = ({ restoreFocus = false } = {}) => {
      if (!menu.open) return;
      menu.open = false;
      if (restoreFocus) summary?.focus({ preventScroll: true });
    };

    menu.addEventListener('toggle', () => {
      summary?.setAttribute('aria-expanded', String(menu.open));
      document.body.classList.toggle(
        'mobile-menu-open',
        [...mobileMenus].some((entry) => entry.open),
      );
    });

    backdrop?.addEventListener('click', () => closeMenu({ restoreFocus: true }));
    menu.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      closeMenu({ restoreFocus: true });
      event.preventDefault();
    });

    for (const link of menu.querySelectorAll('a')) {
      link.addEventListener('click', () => closeMenu());
    }
  }

  window.matchMedia('(min-width: 761px)').addEventListener('change', (event) => {
    if (!event.matches) return;
    for (const menu of mobileMenus) menu.open = false;
  });
}

function initializeScreenshotCarousels() {
  const carousels = document.querySelectorAll('[data-screenshots-carousel]');

  for (const carousel of carousels) {
    const track = carousel.querySelector('[data-screenshots-track]');
    const previous = carousel.querySelector('[data-screenshots-previous]');
    const next = carousel.querySelector('[data-screenshots-next]');
    const items = [...(track?.querySelectorAll('figure') || [])];
    if (!track || !previous || !next || items.length === 0) continue;

    const isRtl = getComputedStyle(track).direction === 'rtl';
    let dragStartX = 0;
    let dragStartScrollLeft = 0;
    let isMouseDown = false;
    let isDragging = false;

    const updateControls = () => {
      const trackRect = track.getBoundingClientRect();
      const firstRect = items[0].getBoundingClientRect();
      const lastRect = items[items.length - 1].getBoundingClientRect();
      const tolerance = 2;
      const overflows = track.scrollWidth > track.clientWidth + tolerance;
      const atStart = isRtl
        ? firstRect.right <= trackRect.right + tolerance
        : firstRect.left >= trackRect.left - tolerance;
      const atEnd = isRtl
        ? lastRect.left >= trackRect.left - tolerance
        : lastRect.right <= trackRect.right + tolerance;

      track.classList.toggle('is-draggable', overflows);
      previous.disabled = !overflows || atStart;
      next.disabled = !overflows || atEnd;
    };

    const scrollOneItem = (direction) => {
      const itemWidth = items[0].getBoundingClientRect().width;
      const gap = Number.parseFloat(getComputedStyle(track).columnGap) || 0;
      const physicalDirection = isRtl ? -direction : direction;
      track.scrollBy({
        left: physicalDirection * (itemWidth + gap),
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      });
    };

    previous.addEventListener('click', () => scrollOneItem(-1));
    next.addEventListener('click', () => scrollOneItem(1));

    track.addEventListener('keydown', (event) => {
      const previousKey = isRtl ? 'ArrowRight' : 'ArrowLeft';
      const nextKey = isRtl ? 'ArrowLeft' : 'ArrowRight';
      if (event.key === previousKey) {
        scrollOneItem(-1);
        event.preventDefault();
      } else if (event.key === nextKey) {
        scrollOneItem(1);
        event.preventDefault();
      }
    });

    track.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || !track.classList.contains('is-draggable')) return;
      dragStartX = event.clientX;
      dragStartScrollLeft = track.scrollLeft;
      isMouseDown = true;
      isDragging = false;
      track.focus({ preventScroll: true });
      event.preventDefault();
    });

    window.addEventListener('mousemove', (event) => {
      if (!isMouseDown) return;
      const delta = event.clientX - dragStartX;
      if (!isDragging && Math.abs(delta) < 4) return;
      isDragging = true;
      track.classList.add('is-dragging');
      track.scrollLeft = dragStartScrollLeft - delta;
      event.preventDefault();
    });

    const endDrag = () => {
      if (!isMouseDown) return;
      isMouseDown = false;
      track.classList.remove('is-dragging');
      isDragging = false;
    };

    window.addEventListener('mouseup', endDrag);
    window.addEventListener('blur', endDrag);
    track.addEventListener('dragstart', (event) => event.preventDefault());
    track.addEventListener('scroll', updateControls, { passive: true });
    window.addEventListener('resize', updateControls);
    updateControls();
  }
}

initializeCookieConsent();

document.addEventListener('click', (event) => {
  const explicitTrigger = event.target.closest('[data-analytics-event]');
  if (explicitTrigger) {
    sendAnalyticsEvent(
      explicitTrigger.dataset.analyticsEvent,
      {
        app_id: explicitTrigger.dataset.appId || '',
        platform: explicitTrigger.dataset.downloadPlatform || '',
        placement: explicitTrigger.dataset.downloadPlacement || analyticsPlacement(explicitTrigger),
        locale: currentAnalyticsLocale(),
        page_path: window.location.pathname,
        target_url: sanitizeUrl(explicitTrigger.href || '', false),
      },
      'marketing',
    );
    return;
  }

  const trigger = event.target.closest('a[href], button, summary');
  if (!trigger || isAnalyticsControl(trigger)) return;

  const feature = describeFeatureClick(trigger);
  if (feature) {
    sendAnalyticsEvent(
      'feature_click',
      {
        ...feature,
        placement: analyticsPlacement(trigger),
        locale: currentAnalyticsLocale(),
        page_path: window.location.pathname,
      },
      'performance',
    );
    return;
  }

  if (!trigger.matches('a[href]')) return;
  const navigation = describeNavigationClick(trigger);
  if (!navigation) return;

  sendAnalyticsEvent(
    'navigation_click',
    {
      ...navigation,
      placement: analyticsPlacement(trigger),
      locale: currentAnalyticsLocale(),
      page_path: window.location.pathname,
    },
    'performance',
  );
});

function describeFeatureClick(trigger) {
  if (trigger.matches('.mobile-menu-button')) {
    return {
      feature_id: 'mobile_navigation',
      feature_action: trigger.closest('.mobile-menu')?.open ? 'close' : 'open',
    };
  }
  if (trigger.matches('[data-mobile-menu-close]')) {
    return { feature_id: 'mobile_navigation', feature_action: 'close' };
  }
  if (trigger.matches('[data-screenshots-previous]')) {
    return { feature_id: 'screenshot_carousel', feature_action: 'previous' };
  }
  if (trigger.matches('[data-screenshots-next]')) {
    return { feature_id: 'screenshot_carousel', feature_action: 'next' };
  }
  return null;
}

function describeNavigationClick(trigger) {
  const href = trigger.getAttribute('href') || '';
  if (!href || href.startsWith('javascript:')) return null;
  if (href.startsWith('mailto:')) return { link_type: 'email', target_url: 'mailto:' };
  if (href.startsWith('tel:')) return { link_type: 'telephone', target_url: 'tel:' };

  try {
    const url = new URL(href, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return {
      link_type: url.origin === window.location.origin ? 'internal' : 'external',
      target_url: sanitizeUrl(url.toString(), false),
    };
  } catch (_) {
    return null;
  }
}

function isAnalyticsControl(trigger) {
  return Boolean(
    trigger.closest('[data-cookie-banner], [data-cookie-preferences]') ||
      trigger.matches(
        '[data-cookie-settings-open], [data-cookie-accept], [data-cookie-reject], [data-cookie-reject-all], [data-cookie-allow-all], [data-cookie-confirm]',
      ),
  );
}

function analyticsPlacement(element) {
  if (element.closest('.mobile-menu')) return 'mobile_menu';
  if (element.closest('header')) return 'header';
  if (element.closest('footer')) return 'footer';
  if (element.closest('main')) return 'content';
  return 'other';
}

function currentAnalyticsLocale() {
  return document.body.dataset.locale || document.documentElement.lang || '';
}

for (const opener of cookieSettingsOpeners) {
  opener.addEventListener('click', () => openCookiePreferences(opener));
}

cookieAccept?.addEventListener('click', () => saveConsent(allPurposes(true)));
cookieReject?.addEventListener('click', () => saveConsent(allPurposes(false)));
cookieRejectAll?.addEventListener('click', () => saveConsent(allPurposes(false)));
cookieAllowAll?.addEventListener('click', () => saveConsent(allPurposes(true)));
cookieConfirm?.addEventListener('click', () => {
  const purposes = {};
  for (const input of cookiePurposeInputs) {
    purposes[input.dataset.cookiePurpose] = input.checked;
  }
  saveConsent(purposes);
});

cookiePreferences?.addEventListener('keydown', handleCookiePreferencesKeydown);

function initializeCookieConsent() {
  removeLegacyConsent();
  if (!hasAnalyticsConfig()) {
    hideCookieBanner();
    closeCookiePreferences({ restoreFocus: false });
    return;
  }

  activeConsent = readConsent();
  if (!activeConsent) {
    clearAllAnalyticsCookies();
    syncPurposeInputs(allPurposes(false));
    showCookieBanner();
    return;
  }

  syncPurposeInputs(activeConsent.purposes);
  hideCookieBanner();
  applyConsent(activeConsent.purposes);
}

function saveConsent(purposes) {
  const normalizedPurposes = normalizePurposes(purposes);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + Number(analyticsConfig.consentMaxAgeDays || 180) * 24 * 60 * 60 * 1000,
  );
  activeConsent = {
    version: cookieConsentVersion,
    policyVersion: analyticsConfig.policyVersion,
    purposes: normalizedPurposes,
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  writeConsent(activeConsent);
  syncPurposeInputs(normalizedPurposes);
  hideCookieBanner();
  closeCookiePreferences();
  applyConsent(normalizedPurposes);
}

function applyConsent(purposes) {
  const normalizedPurposes = normalizePurposes(purposes);
  const enabledDestinations = analyticsConfig.destinations.filter(
    (destination) => normalizedPurposes[destination.purpose],
  );

  for (const destination of analyticsConfig.destinations) {
    const enabled = Boolean(normalizedPurposes[destination.purpose]);
    window[`ga-disable-${destination.measurementId}`] = !enabled;
    if (!enabled) clearAnalyticsCookies(destination.cookiePrefix);
  }

  if (!enabledDestinations.length) {
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', deniedGoogleConsent());
    }
    return;
  }

  loadGoogleAnalytics(enabledDestinations);
}

function loadGoogleAnalytics(destinations) {
  window.dataLayer = window.dataLayer || [];
  window.gtag =
    window.gtag ||
    function gtag() {
      window.dataLayer.push(arguments);
    };

  if (!googleConsentInitialized) {
    window.gtag('consent', 'default', grantedAnalyticsConsent());
    window.gtag('js', new Date());
    googleConsentInitialized = true;
  } else {
    window.gtag('consent', 'update', grantedAnalyticsConsent());
  }

  const firstDestination = destinations[0];
  if (!document.querySelector('[data-batip-analytics-script]')) {
    const script = document.createElement('script');
    script.async = true;
    script.dataset.batipAnalyticsScript = 'true';
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(
      firstDestination.measurementId,
    )}`;
    document.head.append(script);
  }

  for (const destination of destinations) {
    if (initializedDestinations.has(destination.measurementId)) continue;
    configureDestination(destination);
    initializedDestinations.add(destination.measurementId);
  }
}

function configureDestination(destination) {
  const includesMarketing = destination.purpose === 'combined' || destination.purpose === 'marketing';
  const pageLocation = sanitizeUrl(window.location.href, includesMarketing);
  const pageReferrer = includesMarketing ? sanitizeUrl(document.referrer, false) : '';
  const cookieSeconds = Number(analyticsConfig.cookieMaxAgeDays || 180) * 24 * 60 * 60;

  window.gtag('config', destination.measurementId, {
    send_page_view: false,
    cookie_expires: cookieSeconds,
    cookie_update: false,
    cookie_prefix: destination.cookiePrefix,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    page_location: pageLocation,
    page_path: analyticsConfig.pagePath || window.location.pathname,
    page_referrer: pageReferrer,
    transport_type: 'beacon',
  });
  window.gtag('event', 'page_view', {
    send_to: destination.measurementId,
    page_location: pageLocation,
    page_path: analyticsConfig.pagePath || window.location.pathname,
    page_referrer: pageReferrer,
    transport_type: 'beacon',
  });
}

function sendAnalyticsEvent(eventName, params, destinationPurpose = 'performance') {
  const destinations = enabledDestinationsForPurpose(destinationPurpose);
  const payload = {
    ...params,
    send_to: destinations.map((destination) => destination.measurementId),
    transport_type: 'beacon',
  };

  if (typeof window.gtag === 'function' && destinations.length) {
    window.gtag('event', eventName, payload);
  }

  if (analyticsConfig.debug) {
    console.info('[BaTip analytics]', eventName, payload);
  }
}

function enabledDestinationsForPurpose(destinationPurpose) {
  if (!activeConsent) return [];
  return analyticsConfig.destinations.filter(
    (destination) =>
      activeConsent.purposes[destination.purpose] &&
      (destination.purpose === 'combined' || destination.purpose === destinationPurpose),
  );
}

function grantedAnalyticsConsent() {
  return {
    analytics_storage: 'granted',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  };
}

function deniedGoogleConsent() {
  return {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  };
}

function openCookiePreferences(opener) {
  if (!cookiePreferences || !cookiePreferencesPanel) return;
  settingsOpenedFromBanner = Boolean(cookieBanner && !cookieBanner.hidden);
  settingsReturnFocus = opener || document.activeElement;
  syncPurposeInputs(activeConsent?.purposes || allPurposes(false));
  hideCookieBanner();
  cookiePreferences.hidden = false;
  setCookiePreferencesPageBlocked(true);
  requestAnimationFrame(() => {
    const firstInput = cookiePreferences.querySelector('[data-cookie-purpose]');
    (firstInput || cookieRejectAll || cookiePreferencesPanel).focus({ preventScroll: true });
  });
}

function closeCookiePreferences({ restoreFocus = true } = {}) {
  if (!cookiePreferences || cookiePreferences.hidden) return;
  cookiePreferences.hidden = true;
  setCookiePreferencesPageBlocked(false);
  if (!activeConsent && settingsOpenedFromBanner) showCookieBanner();
  if (restoreFocus && settingsReturnFocus?.isConnected) {
    settingsReturnFocus.focus({ preventScroll: true });
  }
  settingsOpenedFromBanner = false;
  settingsReturnFocus = null;
}

function handleCookiePreferencesKeydown(event) {
  if (event.key === 'Escape') {
    closeCookiePreferences();
    event.preventDefault();
    return;
  }
  if (event.key !== 'Tab') return;

  const focusableElements = getCookiePreferencesFocusableElements();
  if (!focusableElements.length) {
    event.preventDefault();
    return;
  }
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    lastElement.focus();
    event.preventDefault();
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    firstElement.focus();
    event.preventDefault();
  }
}

function getCookiePreferencesFocusableElements() {
  if (!cookiePreferences) return [];
  return Array.from(
    cookiePreferences.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => element.offsetParent !== null);
}

function setCookiePreferencesPageBlocked(blocked) {
  if (!cookiePreferences || !document.body) return;
  document.body.classList.toggle('cookie-preferences-lock', blocked);

  for (const element of document.body.children) {
    if (element === cookiePreferences) continue;
    if (blocked) {
      if (!cookiePreferencePageState.has(element)) cookiePreferencePageState.set(element, element.inert);
      element.inert = true;
    } else if (cookiePreferencePageState.has(element)) {
      element.inert = cookiePreferencePageState.get(element);
      cookiePreferencePageState.delete(element);
    }
  }
}

function showCookieBanner() {
  if (cookieBanner && hasAnalyticsConfig()) cookieBanner.hidden = false;
}

function hideCookieBanner() {
  if (cookieBanner) cookieBanner.hidden = true;
}

function syncPurposeInputs(purposes) {
  const normalizedPurposes = normalizePurposes(purposes);
  for (const input of cookiePurposeInputs) {
    input.checked = normalizedPurposes[input.dataset.cookiePurpose];
  }
}

function allPurposes(value) {
  return Object.fromEntries(analyticsConfig.destinations.map((destination) => [destination.purpose, value]));
}

function normalizePurposes(purposes = {}) {
  return Object.fromEntries(
    analyticsConfig.destinations.map((destination) => [destination.purpose, purposes[destination.purpose] === true]),
  );
}

function readConsent() {
  let value;
  try {
    value = window.localStorage.getItem(consentStorageKey());
  } catch (_) {
    value = cookieConsentMemory;
  }
  if (!value) return null;

  try {
    const record = typeof value === 'string' ? JSON.parse(value) : value;
    const hasAllPurposes = analyticsConfig.destinations.every(
      (destination) => typeof record?.purposes?.[destination.purpose] === 'boolean',
    );
    if (
      record?.version !== cookieConsentVersion ||
      record?.policyVersion !== analyticsConfig.policyVersion ||
      !hasAllPurposes ||
      !record.expiresAt ||
      Date.parse(record.expiresAt) <= Date.now()
    ) {
      removeStoredConsent();
      return null;
    }
    return {
      ...record,
      purposes: normalizePurposes(record.purposes),
    };
  } catch (_) {
    removeStoredConsent();
    return null;
  }
}

function writeConsent(record) {
  cookieConsentMemory = record;
  try {
    window.localStorage.setItem(consentStorageKey(), JSON.stringify(record));
  } catch (_) {}
}

function removeStoredConsent() {
  cookieConsentMemory = null;
  try {
    window.localStorage.removeItem(consentStorageKey());
  } catch (_) {}
}

function removeLegacyConsent() {
  try {
    for (const key of analyticsConfig.legacyStorageKeys || []) {
      window.localStorage.removeItem(key);
    }
  } catch (_) {}
}

function consentStorageKey() {
  return analyticsConfig.consentStorageKey || 'batip.cookieConsent.v1';
}

function clearAllAnalyticsCookies() {
  for (const destination of analyticsConfig.destinations || []) {
    clearAnalyticsCookies(destination.cookiePrefix);
  }
  clearAnalyticsCookies('');
}

function clearAnalyticsCookies(prefix) {
  const expectedPrefix = prefix ? `${prefix}_ga` : '_ga';
  const cookieNames = document.cookie
    .split(';')
    .map((cookie) => cookie.split('=')[0].trim())
    .filter((name) => name === expectedPrefix || name.startsWith(`${expectedPrefix}_`));

  for (const name of cookieNames) {
    expireCookie(name, '');
    expireCookie(name, window.location.hostname);
    expireCookie(name, `.${window.location.hostname}`);
    if (window.location.hostname.split('.').length > 1) {
      const rootDomain = window.location.hostname.split('.').slice(-2).join('.');
      expireCookie(name, rootDomain);
      expireCookie(name, `.${rootDomain}`);
    }
  }
}

function expireCookie(name, domain) {
  const domainPart = domain ? `; Domain=${domain}` : '';
  document.cookie = `${name}=; Max-Age=0; Path=/${domainPart}; SameSite=Lax`;
}

function sanitizeUrl(value, includeCampaignParameters) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    const sanitized = new URL(`${url.origin}${url.pathname}`);
    if (includeCampaignParameters) {
      for (const key of marketingParameters) {
        const parameterValue = url.searchParams.get(key);
        if (parameterValue) sanitized.searchParams.set(key, parameterValue.slice(0, 200));
      }
    }
    return sanitized.toString();
  } catch (_) {
    return '';
  }
}

function hasAnalyticsConfig() {
  return Boolean(
    analyticsConfig.enabled &&
      Array.isArray(analyticsConfig.destinations) &&
      analyticsConfig.destinations.length &&
      analyticsConfig.destinations.every(
        (destination) => destination.purpose && destination.measurementId && destination.cookiePrefix,
      ),
  );
}

function initializeLocalePreference() {
  try {
    const savedLocale = window.localStorage.getItem('batip.locale');
    if (!savedLocale) return;
    const expiresAt = window.localStorage.getItem('batip.locale.expiresAt');
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      window.localStorage.removeItem('batip.locale');
      window.localStorage.removeItem('batip.locale.expiresAt');
      return;
    }
    if (!expiresAt) writeLocalePreference(savedLocale);
  } catch (_) {}
}

function writeLocalePreference(locale) {
  try {
    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    window.localStorage.setItem('batip.locale', locale);
    window.localStorage.setItem('batip.locale.expiresAt', expiresAt.toISOString());
  } catch (_) {}
}
