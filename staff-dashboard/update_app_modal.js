const fs = require('fs');
let content = fs.readFileSync('app.js', 'utf8');

const oldFunc = `function openServiceTypeModal(type) {
  document.getElementById('serviceTypeModalOverlay').classList.remove('hidden');
  const isIndoor = type === 'indoor';
  document.getElementById('stModalTitle').textContent = isIndoor ? '🏠 Indoor Services & Clients' : '🌳 Outdoor Services & Clients';
  
  if (isIndoor) {
    // Show search bar and tabs container
    const searchWrapper = document.querySelector('.indoor-search-wrapper');
    const tabsContainer = document.getElementById('indoorCategoryTabs');
    const splitWrapper = document.querySelector('.modal-body-split');
    
    if (searchWrapper) searchWrapper.style.display = 'flex';
    if (tabsContainer) tabsContainer.style.display = 'flex';
    if (splitWrapper) splitWrapper.style.flexDirection = 'row';
    
    window.currentIndoorCategoryTab = "All";
    window.indoorServicesSearchQuery = "";
    const searchInput = document.getElementById('indoorSearch');
    if (searchInput) searchInput.value = "";
    
    renderIndoorModalContent();
  } else {
    // Outdoor simple modal fallback list
    // Hide search bar and tabs container
    const searchWrapper = document.querySelector('.indoor-search-wrapper');
    const tabsContainer = document.getElementById('indoorCategoryTabs');
    
    if (searchWrapper) searchWrapper.style.display = 'none';
    if (tabsContainer) tabsContainer.style.display = 'none';
    
    const relevantServices = serviceCatalog.filter(s => getServiceType(s) === 'outdoor');
    let svcsHtml = '';
    if (relevantServices.length > 0) {
      relevantServices.forEach(s => {
        svcsHtml += \`
          <div class="cs-row ripple" style="background: var(--bg); padding: 16px; border-radius: 12px; border: 1px solid var(--border);">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
              <div style="font-size: 24px;">\${s.icon || '✨'}</div>
              <div style="font-weight: 700; color: var(--primary);">₹\${s.price}</div>
            </div>
            <div style="font-weight: 600; font-size: 14px; margin-bottom: 4px;">\${s.name}</div>
            <div style="font-size: 12px; color: var(--muted); display: flex; align-items: center; gap: 4px;">
              <span>⏱</span> \${s.duration || 60} mins
            </div>
          </div>
        \`;
      });
    } else {
      svcsHtml = '<div style="padding: 20px; text-align: center; color: var(--muted);">No outdoor services available.</div>';
    }
    document.getElementById('indoorServicesGrid').innerHTML = svcsHtml;
    document.getElementById('stCustomersList').innerHTML = '<div style="padding: 20px; text-align: center; color: var(--muted);">Select a service first</div>';
  }
}`;

const newFunc = `function openServiceTypeModal(type) {
  document.getElementById('serviceTypeModalOverlay').classList.remove('hidden');
  window.currentServiceModalType = type;
  
  // Update title based on button clicked
  if (type === 'walkin') {
    document.getElementById('stModalTitle').textContent = '🚶 Walk-in Services';
  } else if (type === 'preschedule') {
    document.getElementById('stModalTitle').textContent = '📅 Pre-schedule Appointments';
  } else {
    document.getElementById('stModalTitle').textContent = '✨ Services';
  }
  
  // We ALWAYS show the full tabbed interface now
  const searchWrapper = document.querySelector('.indoor-search-wrapper');
  const tabsContainer = document.getElementById('indoorCategoryTabs');
  const splitWrapper = document.querySelector('.modal-body-split');
  
  if (searchWrapper) searchWrapper.style.display = 'flex';
  if (tabsContainer) tabsContainer.style.display = 'flex';
  if (splitWrapper) splitWrapper.style.flexDirection = 'row';
  
  window.currentIndoorCategoryTab = "All";
  window.indoorServicesSearchQuery = "";
  const searchInput = document.getElementById('indoorSearch');
  if (searchInput) searchInput.value = "";
  
  renderIndoorModalContent();
}`;

if (content.includes("function openServiceTypeModal(type) {")) {
    // Try exact replacement
    if (content.includes(oldFunc)) {
        content = content.replace(oldFunc, newFunc);
    } else {
        // Fallback: replace with regex
        content = content.replace(/function openServiceTypeModal\(type\) \{[\s\S]*?document\.getElementById\('stCustomersList'\)\.innerHTML = '<div style="padding: 20px; text-align: center; color: var\(--muted\);">Select a service first<\/div>';\s*\}\s*\}/, newFunc);
    }
    fs.writeFileSync('app.js', content);
    console.log("Replaced openServiceTypeModal");
} else {
    console.log("Could not find openServiceTypeModal");
}
