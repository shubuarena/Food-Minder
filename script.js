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
    "dairy": "Dairy",
    "bakery": "Bakery",
    "meat": "Meat & Fish",
    "produce": "Fresh Produce",
    "pantry": "Dry Goods",
    "other": "Other"
};

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

// ============================================
// RENDER + SAVE
// Draws an item into its matching pantry group on screen. Unless it was
// just loaded from the database (see loadPantryFromFirestore below), it
// also saves the item to Firestore so it's still there next time the page
// is opened.
// ============================================
function addItemToPantry(name, matchedKey, saveToDatabase, existingExpiryISO, docId) {
    let computedExpiry;
    if (existingExpiryISO) {
        computedExpiry = new Date(existingExpiryISO);
    } else {
        const daysToAdd = shelfLifeMap[matchedKey] ?? shelfLifeMap["other"];
        computedExpiry = new Date();
        computedExpiry.setDate(computedExpiry.getDate() + daysToAdd);
    }

    const formattedDate = computedExpiry.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    const targetGroup = document.querySelector(`#group-${matchedKey} .items`);
    if (!targetGroup) return;

    const itemMarkup = document.createElement('div');
    itemMarkup.className = 'food-item';
    if (docId) itemMarkup.dataset.id = docId;
    itemMarkup.innerHTML = `<strong>${name}</strong> <span class="date">Expires: ${formattedDate}</span>`;
    targetGroup.appendChild(itemMarkup);

    if (saveToDatabase && currentUserId) {
        db.collection('users').doc(currentUserId).collection('pantryItems').add({
            name: name,
            category: matchedKey,
            expiryDate: computedExpiry.toISOString(),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
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

    db.collection('users').doc(currentUserId).collection('pantryItems')
        .orderBy('createdAt', 'asc')
        .get()
        .then((snapshot) => {
            snapshot.forEach((doc) => {
                const item = doc.data();
                addItemToPantry(item.name, item.category, false, item.expiryDate, doc.id);
            });
        })
        .catch((error) => {
            console.error("Firestore load error:", error);
        });
}
