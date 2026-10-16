const profileIcon = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M4.5 21v-2.5a7.5 7.5 0 0 1 15 0V21"/></svg>`;

export function renderProfilePage() {
  return `<section class="profile-page" data-profile-page aria-labelledby="profile-title">
    <a class="profile-back" href="/intelligent"><span aria-hidden="true">←</span> <span>Back to Super Intelligent Medicine</span></a>
    <header class="profile-heading">
      <div class="profile-icon">${profileIcon}</div>
      <div><h1 id="profile-title">Personal profile</h1><p>Keep your basic contact information up to date.</p></div>
    </header>
    <p class="profile-preview-note" data-profile-preview hidden>Local preview only. Profile details are stored in this browser tab.</p>

    <div class="profile-state-card" data-profile-guest hidden>
      <h2>Sign in to view your profile</h2>
      <p>Use your email account to add and manage your contact information.</p>
      <button class="profile-button profile-button--primary" type="button" data-login-open>Sign in</button>
    </div>
    <div class="profile-state-card" data-profile-loading role="status"><p>Loading your profile…</p></div>
    <div class="profile-state-card" data-profile-load-error hidden role="alert">
      <h2>We could not load your profile</h2>
      <p data-profile-load-error-message>Please try again in a moment.</p>
      <button class="profile-button profile-button--secondary" type="button" data-profile-retry>Try again</button>
    </div>
    <div class="profile-state-card" data-profile-email-only hidden>
      <h2>Sign in with email to complete your profile</h2>
      <p>Your current sign-in and product access are unchanged.</p>
    </div>

    <form class="profile-card" data-profile-form hidden>
      <div class="profile-card-heading">
        <div><h2>Basic information</h2><p>Fields marked * are required.</p></div>
        <span class="profile-complete" data-profile-complete hidden>Profile complete</span>
      </div>
      <div class="profile-fields">
        <div class="profile-field">
          <label for="profile-full-name"><span>Name or preferred name</span> <span class="profile-required" aria-hidden="true">*</span></label>
          <input id="profile-full-name" name="fullName" type="text" maxlength="100" required autocomplete="name">
        </div>
        <div class="profile-field">
          <label for="profile-email"><span>Email</span> <span class="profile-required" aria-hidden="true">*</span></label>
          <input id="profile-email" name="email" type="email" readonly required autocomplete="email" aria-describedby="profile-email-help">
          <p class="profile-field-help" id="profile-email-help">Your verified sign-in email is used for this profile.</p>
        </div>
        <div class="profile-field">
          <label for="profile-contact-phone"><span>Contact phone number</span> <span class="profile-required" aria-hidden="true">*</span></label>
          <input id="profile-contact-phone" name="contactPhone" type="tel" maxlength="32" required autocomplete="tel" aria-describedby="profile-phone-help">
          <p class="profile-field-help" id="profile-phone-help">For contact purposes; this does not change your sign-in method.</p>
        </div>
        <div class="profile-field">
          <label for="profile-organization"><span>Organization or school</span> <span class="profile-optional">(optional)</span></label>
          <input id="profile-organization" name="organization" type="text" maxlength="200" autocomplete="organization">
        </div>
        <div class="profile-field">
          <label for="profile-research-area"><span>Specialty or research area</span> <span class="profile-optional">(optional)</span></label>
          <input id="profile-research-area" name="researchArea" type="text" maxlength="200">
        </div>
        <div class="profile-field profile-date-field">
          <span class="profile-field-label" id="profile-date-label">First completed on</span>
          <p class="profile-date" data-profile-date aria-labelledby="profile-date-label">Recorded when you save</p>
        </div>
      </div>
      <div class="profile-form-footer">
        <p class="profile-purpose">Your contact details help us respond to your product and research enquiries.</p>
        <button class="profile-button profile-button--primary" data-profile-save type="submit">Save profile</button>
      </div>
      <p class="profile-status" data-profile-status role="status" aria-live="polite"></p>
    </form>
  </section>`;
}

export function renderProfilePrompt() {
  return `<dialog class="profile-prompt" id="profile-prompt" data-profile-prompt aria-labelledby="profile-prompt-title" aria-describedby="profile-prompt-description">
    <button class="profile-prompt-close" type="button" data-profile-dismiss aria-label="Close profile reminder"><span aria-hidden="true">×</span></button>
    <div class="profile-icon">${profileIcon}</div>
    <h2 id="profile-prompt-title">Complete your profile</h2>
    <p id="profile-prompt-description">Add your name and contact details to complete your profile.</p>
    <p class="profile-prompt-note">You can do this later and continue using the website.</p>
    <div class="profile-prompt-actions">
      <a class="profile-button profile-button--primary" href="/profile" data-profile-go>Complete profile</a>
      <button class="profile-button profile-button--secondary" type="button" data-profile-dismiss>Maybe later</button>
    </div>
  </dialog>`;
}
