-- Contact details are separate from verified login identities.
CREATE TABLE arviva_user_profiles (
  user_id uuid PRIMARY KEY REFERENCES arviva_users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(full_name) BETWEEN 1 AND 100 AND full_name = btrim(full_name)),
  contact_phone text NOT NULL CHECK (
    char_length(contact_phone) BETWEEN 7 AND 32
    AND contact_phone ~ '^\+?[0-9 ()-]+$'
    AND char_length(regexp_replace(contact_phone, '[^0-9]', '', 'g')) BETWEEN 7 AND 15
  ),
  organization text NOT NULL DEFAULT '' CHECK (char_length(organization) <= 200),
  research_area text NOT NULL DEFAULT '' CHECK (char_length(research_area) <= 200),
  submitted_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
