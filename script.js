// ============================================
// DOM ELEMENT REFERENCES
// ============================================
const loginScreen = document.getElementById('login-screen');
const signupScreen = document.getElementById('signup-screen');
const homeScreen = document.getElementById('home-screen');
const scannerScreen = document.getElementById('scanner-screen');

const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const loginBtn = document.getElementById('login-confirm-btn');
const showSignupLink = document.getElementById('show-signup-link');

const signupNameInput = document.getElementById('signup-name');
const signupEmailInput = document.getElementById('signup-email');
const signupPasswordInput = document.getElementById('signup-password');
const signupBtn = document.getElementById('signup-confirm-btn');
const showLoginLink = document.getElementById('show-login-link');

const logoutLink = document.getElementById('logout-link');

const scanBtn = document.getElementById('scan-btn');
const closeScanBtn = document.getElementById('close-scan');

const expiryScreen = document.getElementById('expiry-screen');
const expiryItemNameLabel = document.getElementById('expiry-item-name');
const expiryItemCategoryLabel = document.getElementById('expiry-item-category');
const expiryDateInput = document.getElementById('expiry-date-input');
const confirmExpiryBtn = document.getElementById('confirm-expiry-btn');
const cancelExpiryLink = document.getElementById('cancel-expiry-link');

const statsCountLabel = document.getElementById('stats-count');
const statsMoneyLabel = document.getElementById('stats-money');
const expiringItemsContainer = document.getElementById('expiring-items');
const eatTodaySuggestionLabel = document.getElementById('eat-today-suggestion');

// Holds the item that's waiting for the user to confirm its expiry date,
// between when a barcode is scanned and when it actually gets saved.
let pendingItem = null;

// Estimated shelf lives (in days) per category - only used to pre-fill a
// starting guess on the Confirm Expiry screen. The user can always change it
// to the exact date printed on the package before saving.
const shelfLifeMap = {
    "dairy": 7,
    "bakery": 4,
    "meat": 3,
    "produce": 5,
    "pantry": 180,
    "other": 10
};

// Friendly labels for the category shown on the Confirm Expiry screen
const categoryLabels = {
    "dairy": "🥛 Dairy",
    "bakery": "🍞 Bakery",
    "meat": "🍗 Meat & Fish",
    "produce": "🥦 Fresh Produce",
    "pantry": "🥫 Dry Goods",
    "other": "🍽️ Other"
};

// Rough, made-up average value (in dollars) per item in each category, used
// only to give a fun ballpark "money saved" figure - not meant to be exact.
const estimatedValueMap = {
    "dairy": 4,
    "bakery": 3,
    "meat": 8,
    "produce": 3,
    "pantry": 5,
    "other": 4
};

// ============================================
// SHARED STATE for the Expiring Soon panel + waste-saved stats
// ============================================

// Tracks every DOM node (an item can appear twice - once in its category,
// once in the Expiring Soon panel) that belongs to each Firestore doc, so
// "mark as used" can remove all of them together.
let itemNodesByDocId = {};

// The list of currently-visible "expiring within 3 days" items, used to
// build the "what should we eat today" suggestion text.
let expiringItemsInfo = [];

// Running totals shown in the stats banner. Loaded from Firestore once at
// login, then updated in memory (and in Firestore) each time something is
// marked as used.
let statsItemsSaved = 0;
let statsMoneySaved = 0;

function registerNode(docId, node) {
    if (!docId) return;
    if (!itemNodesByDocId[docId]) itemNodesByDocId[docId] = [];
    itemNodesByDocId[docId].push(node);
}

function removeItemNodes(docId) {
    (itemNodesByDocId[docId] || []).forEach((node) => {
        node.classList.add('item-exit');
        setTimeout(() => node.remove(), 200);
    });
    delete itemNodesByDocId[docId];
}

// Works out how many days are left until an expiry date, and which colour /
// label that should show up as.
function getUrgencyInfo(expiryDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(expiryDate);
    target.setHours(0, 0, 0, 0);
    const daysLeft = Math.round((target - today) / (1000 * 60 * 60 * 24));
    const formattedDate = expiryDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    if (daysLeft < 0) {
        return { daysLeft, className: 'expiry-expired', label: `Expired ${Math.abs(daysLeft)}d ago` };
    }
    if (daysLeft === 0) {
        return { daysLeft, className: 'expiry-urgent', label: 'Expires today' };
    }
    if (daysLeft === 1) {
        return { daysLeft, className: 'expiry-urgent', label: 'Expires tomorrow' };
    }
    if (daysLeft <= 3) {
        return { daysLeft, className: 'expiry-soon', label: `Expires: ${formattedDate}` };
    }
    return { daysLeft, className: 'expiry-fresh', label: `Expires: ${formattedDate}` };
}

// Builds a simple "use this up today" suggestion based on the categories of
// the soonest-expiring items. Not real recipe intelligence - just a friendly
// nudge in the spirit of the original "what do we eat today?" idea.
function buildEatTodaySuggestion(items) {
    if (items.length === 0) {
        return "✅ Nothing expiring in the next 3 days - your pantry's looking good!";
    }
    const topItems = items.slice(0, 2);
    const names = topItems.map((i) => i.name).join(' & ');
    const cats = new Set(topItems.map((i) => i.category));

    let idea = "using it up before it turns";
    if (cats.has('meat') && cats.has('produce')) {
        idea = "a quick stir-fry";
    } else if (cats.has('meat')) {
        idea = "a simple pan-sear or bake";
    } else if (cats.has('produce')) {
        idea = "a fresh salad or smoothie";
    } else if (cats.has('dairy') || cats.has('bakery')) {
        idea = "a quick toastie or bake";
    }
    return `🍽️ Use up ${names} today - how about ${idea}?`;
}

// Refreshes the Expiring Soon panel's text/visibility based on what's
// currently in expiringItemsInfo. Call this after any add or removal.
function updateExpiringPanelState() {
    eatTodaySuggestionLabel.textContent = buildEatTodaySuggestion(expiringItemsInfo);
}

function renderStatsBanner() {
    statsCountLabel.textContent = statsItemsSaved;
    statsMoneyLabel.textContent = Math.round(statsMoneySaved);
}

// Loads the running "items saved / money saved" totals for this account.
function loadStats() {
    db.collection('users').doc(currentUserId).collection('stats').doc('summary').get()
        .then((doc) => {
            const data = doc.data() || {};
            statsItemsSaved = data.itemsSaved || 0;
            statsMoneySaved = data.moneySaved || 0;
            renderStatsBanner();
        })
        .catch((error) => {
            console.error("Stats load error:", error);
        });
}

// Called whenever an item is marked "used" instead of being left to expire.
// Updates the running totals both on screen and in Firestore.
function recordSavedStat(matchedKey) {
    const value = estimatedValueMap[matchedKey] ?? estimatedValueMap.other;
    statsItemsSaved += 1;
    statsMoneySaved += value;
    renderStatsBanner();

    db.collection('users').doc(currentUserId).collection('stats').doc('summary').set({
        itemsSaved: firebase.firestore.FieldValue.increment(1),
        moneySaved: firebase.firestore.FieldValue.increment(value)
    }, { merge: true }).catch((error) => {
        console.error("Stats save error:", error);
    });
}

// Deletes an item from Firestore and the screen, and counts it as "saved"
// rather than wasted. idHolder is a small { id: ... } object so this still
// works even if the item hasn't finished its first save to Firestore yet.
function markItemUsed(idHolder, matchedKey) {
    const docId = idHolder.id;
    if (!docId || !currentUserId) {
        alert("Still saving this item - give it a second and try again.");
        return;
    }
    db.collection('users').doc(currentUserId).collection('pantryItems').doc(docId).delete()
        .then(() => {
            removeItemNodes(docId);
            expiringItemsInfo = expiringItemsInfo.filter((entry) => entry.idHolder !== idHolder);
            updateExpiringPanelState();
            recordSavedStat(matchedKey);
        })
        .catch((error) => {
            console.error("Delete error:", error);
            alert("Couldn't remove that item - please try again.");
        });
}

// Turns a "days from now" number into a yyyy-mm-dd string, which is the
// format the <input type="date"> field needs.
function estimateExpiryDateString(matchedKey) {
    const daysToAdd = shelfLifeMap[matchedKey] ?? shelfLifeMap["other"];
    const d = new Date();
    d.setDate(d.getDate() + daysToAdd);
    return d.toISOString().split('T')[0];
}

// Shows the Confirm Expiry screen, pre-filled with a starting guess, and
// remembers which item this is for until the user confirms or cancels.
function openExpiryConfirmation(name, matchedKey) {
    pendingItem = { name, matchedKey };
    expiryItemNameLabel.textContent = name;
    expiryItemCategoryLabel.textContent = categoryLabels[matchedKey] || "Other";
    expiryDateInput.value = estimateExpiryDateString(matchedKey);
    homeScreen.classList.add('hidden');
    expiryScreen.classList.remove('hidden');
}

confirmExpiryBtn.addEventListener('click', () => {
    if (!pendingItem) return;
    const chosenDate = expiryDateInput.value;
    if (!chosenDate) {
        alert("Please choose an expiry date.");
        return;
    }
    // Treat the chosen calendar date as local midnight, then store it as a
    // full timestamp so it sorts/compares consistently in Firestore.
    const chosenExpiryISO = new Date(chosenDate + 'T00:00:00').toISOString();
    addItemToPantry(pendingItem.name, pendingItem.matchedKey, true, chosenExpiryISO);
    pendingItem = null;
    expiryScreen.classList.add('hidden');
    homeScreen.classList.remove('hidden');
});

cancelExpiryLink.addEventListener('click', () => {
    pendingItem = null;
    expiryScreen.classList.add('hidden');
    homeScreen.classList.remove('hidden');
});

// ============================================
// FIREBASE SETUP (Firestore database + real accounts)
// ============================================
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
let currentUserId = null;

// This runs automatically whenever someone logs in, signs up, logs out, or
// simply reopens the app with an already-remembered login. It decides which
// screen to show and, once someone is signed in, loads their saved pantry.
auth.onAuthStateChanged((user) => {
    if (user) {
        currentUserId = user.uid;
        loginScreen.classList.add('hidden');
        signupScreen.classList.add('hidden');
        homeScreen.classList.remove('hidden');
        loadPantryFromFirestore();
        loadStats();
    } else {
        currentUserId = null;
        homeScreen.classList.add('hidden');
        signupScreen.classList.add('hidden');
        loginScreen.classList.remove('hidden');
    }
});

// Turns Firebase's technical error codes into messages a user can understand.
function friendlyAuthError(error) {
    switch (error.code) {
        case 'auth/email-already-in-use':
            return "That email already has an account. Try logging in instead.";
        case 'auth/invalid-email':
            return "That doesn't look like a valid email address.";
        case 'auth/weak-password':
            return "Password must be at least 6 characters.";
        case 'auth/user-not-found':
        case 'auth/wrong-password':
        case 'auth/invalid-credential':
            return "Incorrect email or password.";
        default:
            return "Something went wrong: " + error.message;
    }
}

// ============================================
// APPLICATION STATE NAVIGATION
// ============================================

// Switch between the Log In and Sign Up screens
showSignupLink.addEventListener('click', () => {
    loginScreen.classList.add('hidden');
    signupScreen.classList.remove('hidden');
});
showLoginLink.addEventListener('click', () => {
    signupScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
});

// Log In with a real email + password
loginBtn.addEventListener('click', () => {
    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;
    if (!email || !password) {
        alert("Please enter both an email and password.");
        return;
    }
    auth.signInWithEmailAndPassword(email, password).catch((error) => {
        alert(friendlyAuthError(error));
    });
    // onAuthStateChanged (above) takes care of switching to the pantry screen.
});

// Sign Up - creates a brand new account
signupBtn.addEventListener('click', () => {
    const name = signupNameInput.value.trim();
    const email = signupEmailInput.value.trim();
    const password = signupPasswordInput.value;
    if (!name || !email || !password) {
        alert("Please fill in your name, email, and password.");
        return;
    }
    if (password.length < 6) {
        alert("Password must be at least 6 characters.");
        return;
    }
    auth.createUserWithEmailAndPassword(email, password)
        .then((credential) => credential.user.updateProfile({ displayName: name }))
        .catch((error) => {
            alert(friendlyAuthError(error));
        });
    // onAuthStateChanged (above) takes care of switching to the pantry screen.
});

// Log Out
logoutLink.addEventListener('click', () => {
    auth.signOut();
});

const codeReader = new ZXing.BrowserMultiFormatReader();

scanBtn.addEventListener('click', () => {
    homeScreen.classList.add('hidden');
    scannerScreen.classList.remove('hidden');

    codeReader.decodeFromVideoDevice(null, 'video', (result, err) => {
        if (result) {
            codeReader.reset();
            scannerScreen.classList.add('hidden');
            // Home screen stays hidden here - fetchProductFromAPI opens the
            // Confirm Expiry screen once it knows what was scanned.
            fetchProductFromAPI(result.text);
        }
    });
});

closeScanBtn.addEventListener('click', () => {
    codeReader.reset();
    scannerScreen.classList.add('hidden');
    homeScreen.classList.remove('hidden');
});

// ============================================
// EXTERNAL PRODUCT LOOKUP (Open Food Facts)
// ============================================
async function fetchProductFromAPI(barcode) {
    try {
        const response = await fetch(`https://world.openfoodfacts.org/api/v0/product/${barcode}.json`);
        const data = await response.json();

        if (data.status === 1) {
            const productName = data.product.product_name || "Unknown Item";
            const primaryCategory = data.product.categories_tags?.[0]?.toLowerCase() || "other";
            const matchedKey = matchCategory(primaryCategory);
            openExpiryConfirmation(productName, matchedKey);
        } else {
            const fallbackName = prompt("Product unrecognized. Enter name manually:");
            if (fallbackName) {
                openExpiryConfirmation(fallbackName, "other");
            } else {
                // User cancelled the prompt - just go back to the pantry.
                homeScreen.classList.remove('hidden');
            }
        }
    } catch (error) {
        console.error("API Fetch Error:", error);
        homeScreen.classList.remove('hidden');
    }
}

// ============================================
// CATEGORY MATCHING
// Decides which pantry group ("Meat & Fish", "Fresh Produce", etc.) a
// scanned product belongs in, based on the category tag Open Food Facts
// returns for that barcode.
// ============================================
function matchCategory(categoryTag) {
    if (categoryTag.includes('dairy') || categoryTag.includes('cheese') || categoryTag.includes('milk')) {
        return "dairy";
    }
    if (categoryTag.includes('bread') || categoryTag.includes('bakery') || categoryTag.includes('cake')) {
        return "bakery";
    }
    if (categoryTag.includes('meat') || categoryTag.includes('fish') || categoryTag.includes('poultry') ||
        categoryTag.includes('seafood') || categoryTag.includes('shellfish')) {
        return "meat";
    }
    if (categoryTag.includes('fruit') || categoryTag.includes('veg') || categoryTag.includes('plant') ||
        categoryTag.includes('salad')) {
        return "produce";
    }
    if (categoryTag.includes('pantry') || categoryTag.includes('pasta') || categoryTag.includes('snack') ||
        categoryTag.includes('groceries')) {
        return "pantry";
    }
    return "other";
}

// Builds one "row" for an item: name, colour-coded expiry label, and a
// checkmark button to mark it used. Shared by both the category group and
// the Expiring Soon panel, since an urgent item appears in both places.
function buildFoodItemElement(name, matchedKey, urgencyInfo, idHolder) {
    const el = document.createElement('div');
    el.className = 'food-item';

    const info = document.createElement('div');
    info.className = 'food-item-info';
    info.innerHTML = `<strong>${name}</strong> <span class="date ${urgencyInfo.className}">${urgencyInfo.label}</span>`;
    el.appendChild(info);

    const markUsedBtn = document.createElement('button');
    markUsedBtn.className = 'mark-used-btn';
    markUsedBtn.title = 'Mark as used';
    markUsedBtn.textContent = '✓';
    markUsedBtn.addEventListener('click', () => markItemUsed(idHolder, matchedKey));
    el.appendChild(markUsedBtn);

    return el;
}

// ============================================
// RENDER + SAVE
// Draws an item into its matching pantry group (and, if it's expiring
// within 3 days, into the Expiring Soon panel too). Unless it was just
// loaded from the database (see loadPantryFromFirestore below), it also
// saves the item to Firestore so it's still there next time the page opens.
// ============================================
function addItemToPantry(name, matchedKey, saveToDatabase, existingExpiryISO, docId) {
    const computedExpiry = existingExpiryISO ? new Date(existingExpiryISO) : new Date();
    if (!existingExpiryISO) {
        const daysToAdd = shelfLifeMap[matchedKey] ?? shelfLifeMap["other"];
        computedExpiry.setDate(computedExpiry.getDate() + daysToAdd);
    }
    const urgencyInfo = getUrgencyInfo(computedExpiry);

    const targetGroup = document.querySelector(`#group-${matchedKey} .items`);
    if (!targetGroup) return;

    // idHolder lets the "mark as used" button always find the right
    // Firestore doc ID, even if it wasn't known yet at the moment this item
    // was drawn on screen (brand new scans get their ID back a moment later).
    const idHolder = { id: docId || null };

    const itemEl = buildFoodItemElement(name, matchedKey, urgencyInfo, idHolder);
    targetGroup.appendChild(itemEl);

    let expiringEl = null;
    if (urgencyInfo.daysLeft <= 3) {
        expiringEl = buildFoodItemElement(name, matchedKey, urgencyInfo, idHolder);
        expiringItemsContainer.appendChild(expiringEl);
        expiringItemsInfo.push({ idHolder, name, category: matchedKey });
        updateExpiringPanelState();
    }

    if (docId) {
        registerNode(docId, itemEl);
        if (expiringEl) registerNode(docId, expiringEl);
    }

    if (saveToDatabase && currentUserId) {
        db.collection('users').doc(currentUserId).collection('pantryItems').add({
            name: name,
            category: matchedKey,
            expiryDate: computedExpiry.toISOString(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        }).then((docRef) => {
            idHolder.id = docRef.id;
            registerNode(docRef.id, itemEl);
            if (expiringEl) registerNode(docRef.id, expiringEl);
        }).catch((error) => {
            console.error("Firestore save error:", error);
        });
    }
}

// ============================================
// LOAD SAVED ITEMS ON STARTUP
// Runs once, right after the device is signed in, so the pantry looks the
// same as when it was last closed instead of starting empty.
// ============================================
function loadPantryFromFirestore() {
    // Clear anything already drawn on screen first, so items don't get
    // duplicated if this ever runs twice.
    document.querySelectorAll('#pantry-groups .items').forEach((el) => (el.innerHTML = ''));
    itemNodesByDocId = {};
    expiringItemsInfo = [];

    db.collection('users').doc(currentUserId).collection('pantryItems')
        .orderBy('createdAt', 'asc')
        .get()
        .then((snapshot) => {
            snapshot.forEach((doc) => {
                const item = doc.data();
                addItemToPantry(item.name, item.category, false, item.expiryDate, doc.id);
            });
            updateExpiringPanelState();
        })
        .catch((error) => {
            console.error("Firestore load error:", error);
        });
}
