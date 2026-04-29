import Swal from 'sweetalert2';

type ConfirmOptions = {
  title: string;
  text: string;
  confirmButtonText: string;
  cancelButtonText?: string;
  icon?: 'warning' | 'question' | 'error' | 'info' | 'success';
  confirmButtonColor?: string;
};

export async function confirmAction(options: ConfirmOptions) {
  const result = await Swal.fire({
    title: options.title,
    text: options.text,
    icon: options.icon ?? 'warning',
    showCancelButton: true,
    confirmButtonText: options.confirmButtonText,
    cancelButtonText: options.cancelButtonText ?? 'Cancel',
    confirmButtonColor: options.confirmButtonColor ?? '#d33',
    reverseButtons: true,
    customClass: {
      popup: 'rounded-[24px]',
      confirmButton: 'rounded-2xl',
      cancelButton: 'rounded-2xl',
    },
    buttonsStyling: true,
  });

  return result.isConfirmed;
}
