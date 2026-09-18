CREATE OR REPLACE FUNCTION public.add_note_with_mentions(_source_type text, _target_id uuid, _crm_key text, _body text, _author uuid, _author_name text, _mentioned_user_ids uuid[], _mention_all boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _note_id uuid;
  _recipients uuid[];
  _added uuid[];
  _system_id uuid;
  _record_id uuid;
  _effective_crm text;
BEGIN
  IF _source_type NOT IN ('system_note', 'crm_record_note') THEN
    RAISE EXCEPTION 'סוג הערה לא מוכר';
  END IF;
  IF _author IS NULL OR _target_id IS NULL OR btrim(COALESCE(_body, '')) = '' THEN
    RAISE EXCEPTION 'נתוני ההערה חסרים';
  END IF;

  IF _source_type = 'crm_record_note' THEN
    -- Never trust the caller-supplied crm_key: derive it from the record.
    SELECT crm_key INTO _effective_crm FROM public.crm_records WHERE id = _target_id;
    IF _effective_crm IS NULL THEN
      RAISE EXCEPTION 'הרשומה לא נמצאה';
    END IF;
    IF _crm_key IS NOT NULL AND _crm_key <> _effective_crm THEN
      RAISE EXCEPTION 'קוד CRM לא תואם לרשומה';
    END IF;
  ELSE
    _effective_crm := 'yemot';
    IF _crm_key IS NOT NULL AND _crm_key <> 'yemot' THEN
      RAISE EXCEPTION 'קוד CRM לא תואם להערת מערכת';
    END IF;
  END IF;

  _recipients := private.mention_recipients(_effective_crm, _author, _mentioned_user_ids, _mention_all);

  IF _source_type = 'system_note' THEN
    INSERT INTO public.system_notes (system_id, author_id, body)
    VALUES (_target_id, _author, _body) RETURNING id INTO _note_id;
    _system_id := _target_id;
  ELSE
    INSERT INTO public.crm_record_notes (record_id, crm_key, author_id, author_name, body)
    VALUES (_target_id, _effective_crm, _author, _author_name, _body) RETURNING id INTO _note_id;
    _record_id := _target_id;
  END IF;

  _added := private.enqueue_mentions(_source_type, _note_id, _effective_crm, _system_id, _record_id, _author, _recipients);
  RETURN jsonb_build_object('note_id', _note_id, 'recipients', to_jsonb(_added), 'crm_key', _effective_crm);
END $function$;