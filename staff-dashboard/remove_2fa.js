const fs = require('fs');

let content = fs.readFileSync('login.html', 'utf8');

// Remove 2FA Form
content = content.replace(/<form id="twoFactorForm"[^>]*>[\s\S]*?<\/form>/, '');

// Replace the end of promptTwoFactor
const promptEndRegex = /document\.getElementById\('loginForm'\)\.style\.display = 'none';\s*document\.getElementById\('footerLinks'\)\.style\.display = 'none';\s*document\.getElementById\('twoFactorForm'\)\.style\.display = 'block';\s*document\.getElementById\('otp1'\)\.focus\(\);/;

const bypass2FA = `// Skip 2FA and log in directly
            localStorage.setItem('loginInput', phoneInput);
            
            let foundStaff = null;
            if (typeof STAFF_DATA !== 'undefined') {
                for (const key of Object.keys(STAFF_DATA)) {
                    const s = STAFF_DATA[key];
                    if (s.phone && s.phone.replace(/\\D/g, '') === phoneInput.replace(/\\D/g, '')) {
                        foundStaff = s;
                        break;
                    }
                }
            }
            
            if (foundStaff) {
                localStorage.setItem('loggedInUser', foundStaff.name);
                localStorage.setItem('loggedInEmail', foundStaff.email || '');
                localStorage.setItem('loggedInPhone', foundStaff.phone);
                localStorage.setItem('loggedInRole', foundStaff.role);
                localStorage.setItem('loggedInSpecialties', JSON.stringify(foundStaff.specialties || []));
            } else {
                const prevRegPhone = localStorage.getItem('loggedInPhone');
                if (prevRegPhone && prevRegPhone === phoneInput) {
                    // Registered user
                } else {
                    localStorage.setItem('loggedInUser', "Staff Member");
                    localStorage.setItem('loggedInPhone', phoneInput);
                }
            }
            
            localStorage.setItem('lastLoginLocation', currentLoginLocation);
            localStorage.setItem('lastLoginTime', currentLoginTime);
            
            const savedName = localStorage.getItem('loggedInUser') || "Staff Member";
            showToast(\`Welcome back, \${savedName.split(' ')[0]}!\`, 'success', '👋');
            
            setTimeout(() => {
                window.location.href = 'index.html';
            }, 1000);`;

content = content.replace(promptEndRegex, bypass2FA);

// Remove the unused functions
content = content.replace(/function cancelTwoFactor\(\) {[\s\S]*?function verifyTwoFactor\(\) {[\s\S]*?}\n\n        function showToast/m, 'function showToast');

// Also remove 2FA styles
content = content.replace(/\/\* 2FA Styles \*\/[\s\S]*?\.otp-input:focus {[\s\S]*?}/, '');

fs.writeFileSync('login.html', content);
console.log("2FA removed from login.html");
