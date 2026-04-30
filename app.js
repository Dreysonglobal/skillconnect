// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Supabase client
    const supabaseUrl = 'https://gulrsfkgbdijurhnxvjb.supabase.co';
    // NOTE: For Edge Functions + Auth, this should be your Supabase "anon public" key
    // (Project Settings → API). If you see "Invalid JWT" or auth issues, replace this value.
    const supabaseKey = 'sb_publishable_68Kzq25XsQusalcSz62NpA_g5KHp67Q';
    const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);

    // Korapay (public key is safe to expose in the browser)
    const korapayPublicKey = 'pk_live_MUXfi8AufEnLkaZM8t7kxTLRJQFdL4zh1snkc7ag';
    
    // Global variables
    let currentUser = null;
    let currentSlide = 0;
    let slideInterval;
    let deferredInstallPrompt = null;

    function isStandaloneDisplayMode() {
        return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
    }

    function isIosDevice() {
        return /iphone|ipad|ipod/i.test(navigator.userAgent || '');
    }

    function setInstallButtonVisible(visible) {
        const btn = document.getElementById('installAppBtn');
        if (!btn) return;
        btn.style.display = visible ? 'inline-flex' : 'none';
    }

    window.addEventListener('beforeinstallprompt', (event) => {
        // Chrome/Edge: capture the install prompt for a user gesture.
        event.preventDefault();
        deferredInstallPrompt = event;
        if (!isStandaloneDisplayMode()) setInstallButtonVisible(true);
    });

    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        setInstallButtonVisible(false);
    });

    function openInstallDialog() {
        const installDialog = document.getElementById('installDialog');
        if (!installDialog) return;
        document.body.classList.add('terms-open');
        if (typeof installDialog.showModal === 'function') {
            installDialog.showModal();
        } else {
            installDialog.setAttribute('open', '');
        }
    }

    function closeInstallDialog() {
        const installDialog = document.getElementById('installDialog');
        if (!installDialog) return;
        document.body.classList.remove('terms-open');
        if (typeof installDialog.close === 'function') {
            installDialog.close();
        } else {
            installDialog.removeAttribute('open');
        }
    }

    function normalizeText(value) {
        return String(value ?? '').trim().replace(/\s+/g, ' ');
    }

    function normalizePhoneForTel(value) {
        const trimmed = normalizeText(value);
        if (!trimmed) return '';
        const hasLeadingPlus = trimmed.startsWith('+');
        const digitsOnly = trimmed.replace(/[^\d]/g, '');
        if (!digitsOnly) return '';
        return hasLeadingPlus ? `+${digitsOnly}` : digitsOnly;
    }

    function formatDateForUi(value) {
        if (!value) return '';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function computeBillingState(profile) {
        const activationPaid = Boolean(profile?.activation_paid_at);
        const paidUntil = profile?.subscription_paid_until ? new Date(profile.subscription_paid_until) : null;
        const subscriptionActive = Boolean(paidUntil && paidUntil.getTime() > Date.now());
        return { activationPaid, subscriptionActive, paidUntil };
    }

    function updateBillingUI(profile) {
        const billingPanel = document.getElementById('billingPanel');
        const billingMessage = document.getElementById('billingMessage');
        const payActivationBtn = document.getElementById('payActivationBtn');
        const paySubscriptionBtn = document.getElementById('paySubscriptionBtn');

        if (!billingPanel || !billingMessage || !payActivationBtn || !paySubscriptionBtn) return;
        if (!currentUser) {
            billingPanel.style.display = 'none';
            return;
        }

        const { activationPaid, subscriptionActive, paidUntil } = computeBillingState(profile);
        billingPanel.style.display = 'block';

        if (!activationPaid) {
            billingMessage.textContent = 'To make your skill and profile public and findable, you need to pay NGN 300.';
            payActivationBtn.style.display = 'inline-flex';
            paySubscriptionBtn.style.display = 'none';
            return;
        }

        if (!subscriptionActive) {
            billingMessage.textContent = 'To make your skill and profile public and findable, you need to pay NGN 300.';
            payActivationBtn.style.display = 'inline-flex';
            paySubscriptionBtn.style.display = 'none';
            return;
        }

        billingMessage.textContent = `Your profile is public. Next renewal is due on ${formatDateForUi(paidUntil)}.`;
        payActivationBtn.style.display = 'none';
        paySubscriptionBtn.style.display = 'inline-flex';
    }

    async function refreshBillingStatus() {
        if (!currentUser) return null;
        const { data, error } = await supabase
            .from('profiles')
            .select('activation_paid_at, subscription_paid_until, is_public')
            .eq('id', currentUser.id)
            .single();

        if (error) return null;
        updateBillingUI(data);
        return data;
    }

    async function startKorapayPayment(purpose) {
        if (!currentUser) {
            alert('Please login first');
            navigateTo('auth');
            return;
        }

        if (!window.Korapay || typeof window.Korapay.initialize !== 'function') {
            alert('Korapay SDK not loaded. Please refresh the page.');
            return;
        }

        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;

        if (!accessToken) {
            alert('Your session is missing. Please logout and login again.');
            return;
        }

        const { data, error } = await supabase.functions.invoke('korapay-initiate', {
            body: { purpose },
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        
        if (error || !data?.reference) {
            const rawMessage = data?.detail || data?.error || error?.message || 'Unable to start payment. Please try again.';
            const message = String(rawMessage || '');

            if (message.toLowerCase().includes('invalid jwt')) {
                await supabase.auth.signOut();
                showUnauthenticatedUI();
                navigateTo('auth');
                alert('Your login session expired or is invalid. Please login again.');
                return;
            }

            alert(message || 'Unable to start payment. Please try again.');
            return;
        }

        const { reference, amount, currency, notification_url, amount_ngn } = data;

        const profile = await refreshBillingStatus();
        const customerName = normalizeText(profile?.full_name) || normalizeText(currentUser?.email) || 'Customer';
        const customerEmail = normalizeText(currentUser?.email) || '';

        window.Korapay.initialize({
            key: korapayPublicKey,
            reference,
            amount,
            currency: currency || 'NGN',
            customer: { name: customerName, email: customerEmail },
            notification_url,
            narration: purpose === 'activation'
                ? `SkillConnect activation fee (NGN ${amount_ngn ?? 300})`
                : `SkillConnect monthly subscription (NGN ${amount_ngn ?? 300})`,
            onSuccess: function () {
                alert('Payment successful. Your account will be updated shortly.');
                let attempts = 0;
                const timer = setInterval(async () => {
                    attempts += 1;
                    await refreshBillingStatus();
                    if (attempts >= 10) clearInterval(timer);
                }, 2000);
            },
            onFailed: function () {
                alert('Payment failed or was canceled.');
            },
            onClose: function () {
                // no-op
            }
        });
    }
    
    // Nigerian States and LGAs
    const nigerianStates = [
        'Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 
        'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Gombe', 'Imo', 'Jigawa', 
        'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 
        'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'
    ];
    
    const nigerianLGAs = {
        'Lagos': ['Ikeja', 'Victoria Island', 'Lekki', 'Surulere', 'Yaba', 'Agege', 'Alimosho', 'Badagry', 'Epe', 'Ikorodu', 'Ojo', 'Mushin', 'Oshodi'],
        'Abuja': ['Garki', 'Wuse', 'Maitama', 'Asokoro', 'Gwagwalada', 'Kuje', 'Bwari', 'Abaji'],
        'Rivers': ['Port Harcourt', 'Obio-Akpor', 'Eleme', 'Tai', 'Oyigbo', 'Khana', 'Gokana'],
        'Delta': ['Warri', 'Uvwie', 'Ethiope', 'Ughelli', 'Sapele', 'Oshimili'],
        'Ogun': ['Abeokuta', 'Ijebu Ode', 'Sagamu', 'Ota', 'Ifo', 'Ewekoro']
    };
    
    // DOM Elements
    const pages = {
        home: document.getElementById('homePage'),
        search: document.getElementById('searchPage'),
        profile: document.getElementById('profilePage'),
        auth: document.getElementById('authPage')
    };
    
    const navHome = document.getElementById('navHome');
    const navSearch = document.getElementById('navSearch');
    const navProfile = document.getElementById('navProfile');
    const navAuth = document.getElementById('navAuth');
    const navLogout = document.getElementById('navLogout');
    const mobileMenu = document.getElementById('mobileMenu');
    const navLinks = document.getElementById('navLinks');
    
    // Navigation functions
    function navigateTo(pageName) {
        // Hide all pages
        Object.values(pages).forEach(page => {
            if (page) page.classList.remove('active');
        });
        
        // Show selected page
        if (pages[pageName]) {
            pages[pageName].classList.add('active');
        }
        
        // Update active nav link
        [navHome, navSearch, navProfile, navAuth].forEach(link => {
            if (link) link.classList.remove('active');
        });
        
        if (pageName === 'home') navHome.classList.add('active');
        if (pageName === 'search') navSearch.classList.add('active');
        if (pageName === 'profile') navProfile.classList.add('active');
        if (pageName === 'auth') navAuth.classList.add('active');
        
        // Load search results if on search page
        if (pageName === 'search') {
            performSearch();
        }
        
        // Close mobile menu
        if (navLinks) navLinks.classList.remove('active');
    }
    
    // Auth functions
    async function checkAuth() {
        const { data: { user }, error } = await supabase.auth.getUser();

        if (error && String(error.message || '').toLowerCase().includes('invalid jwt')) {
            await supabase.auth.signOut();
            showUnauthenticatedUI();
            return;
        }
        
        if (user) {
            currentUser = user;
            showAuthenticatedUI();
            await loadUserProfile();
        } else {
            showUnauthenticatedUI();
        }
    }
    
    function showAuthenticatedUI() {
        if (navAuth) navAuth.style.display = 'none';
        if (navLogout) navLogout.style.display = 'inline-block';
        if (navProfile) navProfile.style.display = 'inline-block';

        const homeLoginBtn = document.getElementById('homeLoginBtn');
        const homeRegisterBtn = document.getElementById('homeRegisterBtn');
        if (homeLoginBtn) homeLoginBtn.style.display = 'none';
        if (homeRegisterBtn) homeRegisterBtn.style.display = 'none';
    }
    
    function showUnauthenticatedUI() {
        if (navAuth) navAuth.style.display = 'inline-block';
        if (navLogout) navLogout.style.display = 'none';
        if (navProfile) navProfile.style.display = 'none';
        currentUser = null;

        const homeLoginBtn = document.getElementById('homeLoginBtn');
        const homeRegisterBtn = document.getElementById('homeRegisterBtn');
        if (homeLoginBtn) homeLoginBtn.style.display = 'inline-flex';
        if (homeRegisterBtn) homeRegisterBtn.style.display = 'inline-flex';
    }
    
    async function loadUserProfile() {
        if (!currentUser) return;
        
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', currentUser.id)
            .single();
        
        if (data && !error) {
            document.getElementById('fullName').value = data.full_name || '';
            document.getElementById('businessName').value = data.business_name || '';
            document.getElementById('phoneNumber').value = data.phone_number || '';
            document.getElementById('skill').value = data.skill || '';
            document.getElementById('country').value = data.country || '';
            document.getElementById('state').value = data.state || '';
            document.getElementById('area').value = data.area || '';
            
            if (data.state) {
                loadLGAsForProfile(data.state);
                setTimeout(() => {
                    document.getElementById('lga').value = data.lga || '';
                }, 100);
            }
            
            if (data.avatar_url) {
                document.getElementById('avatarPreview').src = data.avatar_url;
            }

            updateBillingUI(data);
        } else {
            updateBillingUI(null);
        }
    }
    
    function loadStates() {
        const stateSelect = document.getElementById('state');
        const stateFilter = document.getElementById('stateFilter');
        
        const statesHTML = '<option value="">Select State</option>' + 
            nigerianStates.map(state => `<option value="${state}">${state}</option>`).join('');
        
        if (stateSelect) stateSelect.innerHTML = statesHTML;
        if (stateFilter) stateFilter.innerHTML = '<option value="">All States</option>' + 
            nigerianStates.map(state => `<option value="${state}">${state}</option>`).join('');
    }
    
    function loadLGAsForProfile(state) {
        const lgaSelect = document.getElementById('lga');
        const lgas = nigerianLGAs[state] || ['Central', 'North', 'South', 'East', 'West'];
        
        lgaSelect.innerHTML = '<option value="">Select LGA</option>' + 
            lgas.map(lga => `<option value="${lga}">${lga}</option>`).join('');
    }
    
    function loadLGAsForFilter(state) {
        const lgaFilter = document.getElementById('lgaFilter');
        const lgas = nigerianLGAs[state] || ['Central', 'North', 'South', 'East', 'West'];
        
        lgaFilter.innerHTML = '<option value="">All LGAs</option>' + 
            lgas.map(lga => `<option value="${lga}">${lga}</option>`).join('');
    }
    
    async function handleLogin(event) {
        event.preventDefault();
        const email = normalizeText(document.getElementById('loginEmail').value);
        const password = String(document.getElementById('loginPassword').value || '');
        
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        
        if (error) {
            console.error('Login error:', error);
            alert('Login failed: ' + error.message);
        } else {
            currentUser = data.user;
            showAuthenticatedUI();
            await loadUserProfile();
            navigateTo('profile');
            alert('Login successful!');
        }
    }
    
    async function handleRegister(event) {
        event.preventDefault();

        const termsCheckbox = document.getElementById('registerTerms');
        if (termsCheckbox && !termsCheckbox.checked) {
            alert('Please agree to the Terms & Conditions to create an account.');
            termsCheckbox.focus();
            return;
        }

        const email = normalizeText(document.getElementById('registerEmail').value);
        const password = String(document.getElementById('registerPassword').value || '');
        
        const { data, error } = await supabase.auth.signUp({ email, password });
        
        if (error) {
            console.error('Registration error:', error);
            alert('Registration failed: ' + error.message);
        } else {
            // Create profile entry
            const { error: profileError } = await supabase
                .from('profiles')
                .insert([{ id: data.user.id }]);
            
            if (profileError) {
                console.error('Profile creation error:', profileError);
            }
            
            alert('Registration successful! Please login. After login, you must pay ₦300 to make your profile public, then renew ₦300 monthly to stay public.');
            switchAuthTab('login');
            document.getElementById('registerEmail').value = '';
            document.getElementById('registerPassword').value = '';
        }
    }
    
    async function handleLogout() {
        await supabase.auth.signOut();
        showUnauthenticatedUI();
        navigateTo('home');
        alert('Logged out successfully');
    }
    
    async function handleProfileUpdate(event) {
        event.preventDefault();
        
        if (!currentUser) {
            alert('Please login first');
            navigateTo('auth');
            return;
        }
        
        const profileData = {
            full_name: normalizeText(document.getElementById('fullName').value),
            business_name: normalizeText(document.getElementById('businessName').value),
            phone_number: normalizeText(document.getElementById('phoneNumber').value),
            skill: normalizeText(document.getElementById('skill').value),
            location: normalizeText([
                document.getElementById('country').value,
                document.getElementById('state').value,
                document.getElementById('lga').value,
                document.getElementById('area').value
            ].filter(Boolean).join(', ')),
            country: normalizeText(document.getElementById('country').value),
            state: normalizeText(document.getElementById('state').value),
            lga: normalizeText(document.getElementById('lga').value),
            area: normalizeText(document.getElementById('area').value),
            updated_at: new Date().toISOString()
        };
        
        const { data, error } = await supabase
            .from('profiles')
            .upsert({ id: currentUser.id, ...profileData }, { onConflict: 'id' })
            .select('*')
            .single();
        
        if (error) {
            alert('Error updating profile: ' + error.message);
        } else {
            if (data) {
                document.getElementById('fullName').value = data.full_name || '';
                document.getElementById('businessName').value = data.business_name || '';
                document.getElementById('phoneNumber').value = data.phone_number || '';
                document.getElementById('skill').value = data.skill || '';
                document.getElementById('country').value = data.country || '';
                document.getElementById('state').value = data.state || '';
                document.getElementById('area').value = data.area || '';
                if (data.state) loadLGAsForProfile(data.state);
                if (data.lga) document.getElementById('lga').value = data.lga || '';
            }
            alert('Profile updated successfully!');
        }
    }
    
    async function handleAvatarUpload(event) {
        const file = event.target.files[0];
        if (!file || !currentUser) {
            if (!currentUser) alert('Please login first');
            return;
        }
        
        const fileExt = file.name.split('.').pop();
        const fileName = `${currentUser.id}/${Date.now()}.${fileExt}`;
        
        const { error: uploadError } = await supabase.storage
            .from('avatars')
            .upload(fileName, file);
        
        if (uploadError) {
            alert('Error uploading image: ' + uploadError.message);
            return;
        }
        
        const { data: { publicUrl } } = supabase.storage
            .from('avatars')
            .getPublicUrl(fileName);
        
        const { error: updateError } = await supabase
            .from('profiles')
            .update({ avatar_url: publicUrl })
            .eq('id', currentUser.id);
        
        if (updateError) {
            alert('Error updating avatar: ' + updateError.message);
        } else {
            document.getElementById('avatarPreview').src = publicUrl;
            alert('Avatar updated successfully!');
        }
    }
    
    async function performSearch() {
        const skill = normalizeText(document.getElementById('skillSearch').value);
        const country = normalizeText(document.getElementById('countryFilter').value);
        const state = normalizeText(document.getElementById('stateFilter').value);
        const lga = normalizeText(document.getElementById('lgaFilter').value);
        const area = normalizeText(document.getElementById('areaFilter').value);
        
        const nowIso = new Date().toISOString();
        let query = supabase
            .from('profiles')
            .select('*')
            .eq('is_public', true)
            .not('activation_paid_at', 'is', null)
            .gt('subscription_paid_until', nowIso);
        
        if (skill) query = query.ilike('skill', `%${skill}%`);
        if (country) query = query.eq('country', country);
        if (state) query = query.eq('state', state);
        if (lga) query = query.eq('lga', lga);
        if (area) query = query.ilike('area', `%${area}%`);
        
        const { data, error } = await query;
        
        const resultsDiv = document.getElementById('searchResults');
        
        if (error) {
            resultsDiv.innerHTML = '<div class="error-message">Error loading results: ' + error.message + '</div>';
            return;
        }
        
        if (!data || data.length === 0) {
            resultsDiv.innerHTML = '<div class="loading">No professionals found matching your criteria</div>';
            return;
        }
        
        resultsDiv.innerHTML = data.map(profile => {
            const phoneRaw = normalizeText(profile.phone_number);
            const phoneForTel = normalizePhoneForTel(phoneRaw);

            const phoneHtml = phoneRaw
                ? `<div class="phone-row"><div class="phone-number"><i class="fas fa-phone"></i> ${phoneRaw}</div>${phoneForTel ? `<a class="call-btn" href="tel:${phoneForTel}"><i class="fas fa-phone"></i> Call</a>` : ''}</div>`
                : `<div class="phone-row"><div class="phone-number"><i class="fas fa-phone"></i> Not provided</div></div>`;

            return `
                <div class="profile-card">
                    <img src="${profile.avatar_url || 'images/media.png'}" alt="${profile.full_name || 'Professional'}">
                    <div class="profile-card-info">
                        <h3>${profile.full_name || 'Anonymous'}</h3>
                        <div class="skill"><i class="fas fa-tools"></i> ${profile.skill || 'Not specified'}</div>
                        <div class="location"><i class="fas fa-map-marker-alt"></i> ${profile.area || ''}${profile.area && profile.lga ? ', ' : ''}${profile.lga || ''}${(profile.area || profile.lga) && profile.state ? ', ' : ''}${profile.state || ''}</div>
                        ${profile.business_name ? `<div class="business"><i class="fas fa-store"></i> ${profile.business_name}</div>` : ''}
                        ${phoneHtml}
                    </div>
                </div>
            `;
        }).join('');
    }
    
    function switchAuthTab(tab) {
        const tabs = document.querySelectorAll('.auth-tab');
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        
        tabs.forEach(t => t.classList.remove('active'));
        
        if (tab === 'login') {
            tabs[0].classList.add('active');
            loginForm.classList.add('active');
            registerForm.classList.remove('active');
        } else {
            tabs[1].classList.add('active');
            registerForm.classList.add('active');
            loginForm.classList.remove('active');
        }
    }
    
    // Slider Functions
    function setupSlider() {
        const slides = document.querySelectorAll('.slide');
        const dotsContainer = document.getElementById('sliderDots');
        
        if (!slides.length || !dotsContainer) return;
        
        // Create dots
        slides.forEach((_, index) => {
            const dot = document.createElement('div');
            dot.classList.add('dot');
            if (index === 0) dot.classList.add('active');
            dot.addEventListener('click', () => goToSlide(index));
            dotsContainer.appendChild(dot);
        });
        
        function goToSlide(index) {
            slides.forEach(slide => slide.classList.remove('active'));
            document.querySelectorAll('.dot').forEach(dot => dot.classList.remove('active'));
            
            currentSlide = (index + slides.length) % slides.length;
            slides[currentSlide].classList.add('active');
            document.querySelectorAll('.dot')[currentSlide].classList.add('active');
        }
        
        function nextSlide() {
            clearInterval(slideInterval);
            goToSlide(currentSlide + 1);
            startAutoSlide();
        }
        
        function prevSlide() {
            clearInterval(slideInterval);
            goToSlide(currentSlide - 1);
            startAutoSlide();
        }
        
        function startAutoSlide() {
            if (slideInterval) clearInterval(slideInterval);
            slideInterval = setInterval(() => goToSlide(currentSlide + 1), 5000);
        }
        
        // Add event listeners
        document.getElementById('prevSlide')?.addEventListener('click', prevSlide);
        document.getElementById('nextSlide')?.addEventListener('click', nextSlide);
        
        startAutoSlide();
    }

    function setupPasswordToggles() {
        document.querySelectorAll('.password-toggle[data-target]').forEach((button) => {
            const targetId = button.getAttribute('data-target');
            const input = targetId ? document.getElementById(targetId) : null;
            const icon = button.querySelector('i');
            if (!input) return;

            button.addEventListener('click', () => {
                const wasText = input.type === 'text';
                const selectionStart = input.selectionStart;
                const selectionEnd = input.selectionEnd;

                input.type = wasText ? 'password' : 'text';
                button.setAttribute('aria-pressed', String(!wasText));
                button.setAttribute('aria-label', wasText ? 'Show password' : 'Hide password');

                if (icon) {
                    icon.classList.toggle('fa-eye', wasText);
                    icon.classList.toggle('fa-eye-slash', !wasText);
                }

                input.focus({ preventScroll: true });
                if (selectionStart !== null && selectionEnd !== null) {
                    try {
                        input.setSelectionRange(selectionStart, selectionEnd);
                    } catch {
                        // Some browsers may block selection manipulation for password inputs.
                    }
                }
            });
        });
    }
    
    // Event Listeners
    function setupEventListeners() {
        // Navigation
        navHome.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('home');
        });
        
        navSearch.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('search');
        });
        
        navProfile.addEventListener('click', (e) => {
            e.preventDefault();
            if (currentUser) {
                navigateTo('profile');
            } else {
                alert('Please login first');
                navigateTo('auth');
            }
        });
        
        navAuth.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('auth');
        });
        
        navLogout.addEventListener('click', (e) => {
            e.preventDefault();
            handleLogout();
        });

        // Home quick actions
        document.getElementById('homeSearchBtn')?.addEventListener('click', () => navigateTo('search'));
        document.getElementById('homeLoginBtn')?.addEventListener('click', () => {
            navigateTo('auth');
            switchAuthTab('login');
        });
        document.getElementById('homeRegisterBtn')?.addEventListener('click', () => {
            navigateTo('auth');
            switchAuthTab('register');
        });
        document.getElementById('installAppBtn')?.addEventListener('click', async () => {
            if (isStandaloneDisplayMode()) {
                setInstallButtonVisible(false);
                return;
            }
            if (deferredInstallPrompt && typeof deferredInstallPrompt.prompt === 'function') {
                try {
                    deferredInstallPrompt.prompt();
                    await deferredInstallPrompt.userChoice;
                } finally {
                    deferredInstallPrompt = null;
                    setInstallButtonVisible(false);
                }
                return;
            }
            if (isIosDevice()) {
                openInstallDialog();
                return;
            }
            alert('Install is not available yet. Please use the browser menu and look for "Install app".');
        });
        
        // Mobile menu
        mobileMenu.addEventListener('click', () => {
            navLinks.classList.toggle('active');
        });
        
        // Auth forms
        document.getElementById('loginFormElement').addEventListener('submit', handleLogin);
        document.getElementById('registerFormElement').addEventListener('submit', handleRegister);
        setupPasswordToggles();

        // Terms dialog (Register)
        const termsDialog = document.getElementById('termsDialog');
        const openTermsBtn = document.getElementById('openTermsBtn');
        const closeTermsBtn = document.getElementById('closeTermsBtn');
        const closeTermsBtn2 = document.getElementById('closeTermsBtn2');
        const agreeTermsBtn = document.getElementById('agreeTermsBtn');
        const termsCheckbox = document.getElementById('registerTerms');

        const openTerms = () => {
            if (!termsDialog) return;
            document.body.classList.add('terms-open');
            if (typeof termsDialog.showModal === 'function') {
                termsDialog.showModal();
            } else {
                termsDialog.setAttribute('open', '');
            }
        };

        const closeTerms = () => {
            if (!termsDialog) return;
            document.body.classList.remove('terms-open');
            if (typeof termsDialog.close === 'function') {
                termsDialog.close();
            } else {
                termsDialog.removeAttribute('open');
            }
        };

        openTermsBtn?.addEventListener('click', openTerms);
        closeTermsBtn?.addEventListener('click', closeTerms);
        closeTermsBtn2?.addEventListener('click', closeTerms);
        agreeTermsBtn?.addEventListener('click', () => {
            if (termsCheckbox) termsCheckbox.checked = true;
            closeTerms();
        });

        termsDialog?.addEventListener('close', () => document.body.classList.remove('terms-open'));
        termsDialog?.addEventListener('cancel', (e) => {
            e.preventDefault();
            closeTerms();
        });
        termsDialog?.addEventListener('click', (e) => {
            if (e.target === termsDialog) closeTerms();
        });

        // Install dialog (iPhone/iPad helper)
        const installDialog = document.getElementById('installDialog');
        const closeInstallBtn = document.getElementById('closeInstallBtn');
        const closeInstallBtnX = document.getElementById('closeInstallBtnX');

        closeInstallBtn?.addEventListener('click', closeInstallDialog);
        closeInstallBtnX?.addEventListener('click', closeInstallDialog);

        installDialog?.addEventListener('close', () => document.body.classList.remove('terms-open'));
        installDialog?.addEventListener('cancel', (e) => {
            e.preventDefault();
            closeInstallDialog();
        });
        installDialog?.addEventListener('click', (e) => {
            if (e.target === installDialog) closeInstallDialog();
        });
        
        // Auth tabs
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                switchAuthTab(tab.dataset.auth);
            });
        });
        
        // Profile form
        document.getElementById('profileForm').addEventListener('submit', handleProfileUpdate);

        // Billing actions
        document.getElementById('payActivationBtn')?.addEventListener('click', () => startKorapayPayment('activation'));
        document.getElementById('paySubscriptionBtn')?.addEventListener('click', () => startKorapayPayment('subscription'));
        
        // Avatar upload
        document.getElementById('avatarUpload').addEventListener('change', handleAvatarUpload);
        
        // State change for profile
        document.getElementById('state').addEventListener('change', (e) => {
            loadLGAsForProfile(e.target.value);
        });
        
        // Search
        document.getElementById('searchBtn').addEventListener('click', performSearch);

        // Customer care (WhatsApp)
        document.getElementById('customerCareBtn')?.addEventListener('click', () => {
            const url = 'https://wa.me/2349056068122';
            window.open(url, '_blank', 'noopener,noreferrer');
        });
        
        // State filter change
        document.getElementById('stateFilter').addEventListener('change', (e) => {
            if (e.target.value) {
                loadLGAsForFilter(e.target.value);
            } else {
                document.getElementById('lgaFilter').innerHTML = '<option value="">All LGAs</option>';
            }
        });
        
        // Enter key in search
        const searchInputs = ['skillSearch', 'areaFilter'];
        searchInputs.forEach(id => {
            document.getElementById(id)?.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') performSearch();
            });
        });
    }
    
    // Initialize everything
    function init() {
        loadStates();
        setupSlider();
        setupEventListeners();
        if (isIosDevice() && !isStandaloneDisplayMode()) setInstallButtonVisible(true);
        checkAuth();
    }
    
    // Start the app
    init();
});
