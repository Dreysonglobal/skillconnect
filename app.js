// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
    // Initialize Supabase client
    const supabaseUrl = 'https://gulrsfkgbdijurhnxvjb.supabase.co';
    const supabaseKey = 'sb_publishable_68Kzq25XsQusalcSz62NpA_g5KHp67Q';
    const supabase = window.supabase.createClient(supabaseUrl, supabaseKey);
    
    // Global variables
    let currentUser = null;
    let currentSlide = 0;
    let slideInterval;

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
        const { data: { user } } = await supabase.auth.getUser();
        
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
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        
        if (error) {
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
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        
        const { data, error } = await supabase.auth.signUp({ email, password });
        
        if (error) {
            alert('Registration failed: ' + error.message);
        } else {
            // Create profile entry
            const { error: profileError } = await supabase
                .from('profiles')
                .insert([{ id: data.user.id }]);
            
            if (profileError) {
                console.error('Profile creation error:', profileError);
            }
            
            alert('Registration successful! Please login.');
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
        
        let query = supabase.from('profiles').select('*');
        
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
                    <img src="${profile.avatar_url || 'https://via.placeholder.com/300x200'}" alt="${profile.full_name || 'Professional'}">
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
        
        // Mobile menu
        mobileMenu.addEventListener('click', () => {
            navLinks.classList.toggle('active');
        });
        
        // Auth forms
        document.getElementById('loginFormElement').addEventListener('submit', handleLogin);
        document.getElementById('registerFormElement').addEventListener('submit', handleRegister);
        
        // Auth tabs
        document.querySelectorAll('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                switchAuthTab(tab.dataset.auth);
            });
        });
        
        // Profile form
        document.getElementById('profileForm').addEventListener('submit', handleProfileUpdate);
        
        // Avatar upload
        document.getElementById('avatarUpload').addEventListener('change', handleAvatarUpload);
        
        // State change for profile
        document.getElementById('state').addEventListener('change', (e) => {
            loadLGAsForProfile(e.target.value);
        });
        
        // Search
        document.getElementById('searchBtn').addEventListener('click', performSearch);
        
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
        checkAuth();
    }
    
    // Start the app
    init();
});
